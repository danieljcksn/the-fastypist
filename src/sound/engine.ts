import { render, softClipCurve, VARIANTS, type RenderClass } from "./synth";
import type { KeyClass, KeySound, SoundPrefs, SoundProfile } from "./types";

const VOICES = 6;
const MIN_GAP_MS = 8;
const HOLD_MS = 50;
const PREVIEW_HOLD_MS = 1000;
const STALL_MS = 150;
const RECREATE_MS = 500;
const SLEEP_AFTER_MS = 30_000;
const IDLE_FALLBACK_MS = 32;
const IDLE_DEADLINE_MS = 100;
const PRE_GAIN = 0.5;
const PAN_WIDTH = 0.35;
const PAN_JITTER = 0.03;
const MAX_RECREATES = 2;

const RENDER_ORDER = (Object.keys(VARIANTS) as RenderClass[]).flatMap((cls) =>
  Array.from({ length: VARIANTS[cls] }, (_, variant): [RenderClass, number] => [cls, variant]),
);

const PAN = new Map<string, number>();
// x is the first key's centre in key units on a 15-unit block, so row stagger is kept.
// Backslash has one code for two positions (ANSI and ISO/ABNT2); ANSI wins.
const place = (x: number, codes: string[]) =>
  codes.forEach((code, i) => PAN.set(code, (x + i - 7.5) / 7.5));
const keys = (letters: string) => [...letters].map((letter) => `Key${letter}`);
place(0.5, ["Backquote", ...[..."1234567890"].map((d) => `Digit${d}`), "Minus", "Equal", "IntlYen"]);
place(2, [...keys("QWERTYUIOP"), "BracketLeft", "BracketRight"]);
place(2.25, [...keys("ASDFGHJKL"), "Semicolon", "Quote"]);
place(1.75, ["IntlBackslash", ...keys("ZXCVBNM"), "Comma", "Period", "Slash", "IntlRo"]);
place(14, ["Enter"]);
place(14.25, ["Backspace"]);
place(14.25, ["Backslash"]);
place(4.5, ["NonConvert"]);
place(5, ["Lang2"]);
place(8.5, ["Convert"]);
place(9, ["Lang1"]);
place(10, ["KanaMode"]);

export function panForCode(code: string): number {
  return PAN.get(code) ?? (code.startsWith("Numpad") ? 1 : 0);
}

interface Strip {
  gain: GainNode;
  pan: StereoPannerNode;
  source: AudioBufferSourceNode | null;
  endsAt: number;
}

type Bank = Record<RenderClass, AudioBuffer[]>;
const emptyBank = (): Bank => ({ key: [], space: [], enter: [], backspace: [], up: [], error: [] });

const clampVolume = (volume: number) => Math.min(1, Math.max(0, volume)) || 0;

const settle = (promise: Promise<unknown> | undefined, then?: () => void) => {
  void promise?.then(then, () => undefined);
};

const closeQuietly = (context: AudioContext | undefined) => {
  try {
    settle(context?.close());
  } catch {
    // A context this stuck may refuse to close; nothing references it afterwards.
  }
};

// The deadline matters: after a mouse click on a page with nothing animating, Chromium
// stopped running idle callbacks, and the bank was still empty 30 s after one click on.
const onIdle = (task: () => void) => {
  if (typeof requestIdleCallback === "function") requestIdleCallback(task, { timeout: IDLE_DEADLINE_MS });
  else setTimeout(task, IDLE_FALLBACK_MS);
};

const toBuffer = (context: AudioContext, samples: Float32Array<ArrayBuffer>) => {
  const buffer = context.createBuffer(1, samples.length, context.sampleRate);
  buffer.getChannelData(0).set(samples);
  return buffer;
};

function createKeySound(initial: SoundPrefs): KeySound {
  let prefs: SoundPrefs = { ...initial, volume: clampVolume(initial.volume) };
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let strips: Strip[] = [];

  let bank = emptyBank();
  let bankProfile: SoundProfile | null = null;
  let bankRate = 0;
  let queue: [RenderClass, number][] = [];
  let stepping = false;
  let building = false;

  let failed = false;
  let disposed = false;
  let asleep = false;
  let sleepWanted = false;
  let everRunning = false;
  let recreates = 0;

  let held: { cls: KeyClass; code: string; isError: boolean; at: number } | null = null;
  let wantedPreview: { profile: SoundProfile; at: number } | null = null;
  const downs = new Set<string>();
  const lastVariant: Record<RenderClass, number> = { key: 0, space: 0, enter: 0, backspace: 0, up: 0, error: 0 };

  let lastStrikeAt = -Infinity;
  let lastUseAt = 0;
  let clockValue = -1;
  let clockMovedAt = 0;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  function warm() {
    if (ctx || building || failed || disposed) return;
    if (typeof AudioContext === "undefined") {
      failed = true;
      return;
    }
    building = true;
    onIdle(build);
  }

  // The constructor is synchronous and blocked for 0.42 to 21.6 s on a starved VM,
  // so it runs on idle and never on a keystroke.
  function build() {
    building = false;
    if (disposed || ctx || failed || (!prefs.enabled && !wantedPreview)) return;
    let context: AudioContext | undefined;
    try {
      setAmbientSession();
      context = new AudioContext();
      const pre = context.createGain();
      pre.gain.value = PRE_GAIN;
      // Not DynamicsCompressorNode: its fixed look-ahead adds 6.00 ms to every click.
      const shaper = context.createWaveShaper();
      shaper.oversample = "none";
      shaper.curve = softClipCurve();
      const mix = context.createGain();
      mix.gain.value = prefs.volume * prefs.volume;
      mix.connect(pre);
      pre.connect(shaper);
      shaper.connect(context.destination);
      const built = context;
      strips = Array.from({ length: VOICES }, () => {
        const gain = built.createGain();
        const pan = built.createStereoPanner();
        gain.connect(pan);
        pan.connect(mix);
        return { gain, pan, source: null, endsAt: 0 };
      });
      master = mix;
      ctx = context;
      everRunning = false;
      sleepWanted = false;
      clockValue = context.currentTime;
      clockMovedAt = performance.now();
      context.onstatechange = onState;
      if (bankRate !== context.sampleRate) bankProfile = null;
      fillBank();
      scheduleStep();
      if (context.state === "running") onState();
      else if (wantedPreview) wake(context);
    } catch {
      failed = true;
      closeQuietly(context);
    }
  }

  function setAmbientSession() {
    try {
      const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
      if (session) session.type = "ambient";
    } catch {
      // A click still works under the default session.
    }
  }

  function fillBank() {
    if (!ctx || !prefs.enabled || bankProfile === prefs.profile) return;
    bankProfile = prefs.profile;
    bankRate = ctx.sampleRate;
    bank = emptyBank();
    queue = RENDER_ORDER.slice();
    scheduleStep();
  }

  function scheduleStep() {
    if (stepping || !queue.length) return;
    stepping = true;
    onIdle(renderStep);
  }

  function renderStep() {
    stepping = false;
    const profile = bankProfile;
    const context = ctx;
    if (disposed || failed || !context || !profile) return;
    const next = queue.shift();
    if (!next) return;
    const [cls, variant] = next;
    try {
      bank[cls].push(toBuffer(context, render(profile, cls, variant, context.sampleRate)));
      scheduleStep();
    } catch {
      failed = true;
      abandon(context);
    }
  }

  function onState() {
    try {
      const context = ctx;
      if (!context) return;
      if (context.state !== "running") {
        if (everRunning) asleep = true;
        return;
      }
      // A resume asked for before a sleep can land after it, when sleep() saw "suspended" and had nothing to do.
      if (sleepWanted) {
        sleep();
        return;
      }
      const now = performance.now();
      everRunning = true;
      asleep = false;
      lastUseAt = now;
      armSleep();
      clockValue = context.currentTime;
      clockMovedAt = now;

      const key = held;
      held = null;
      // A late click is worse than none.
      if (key && now - key.at <= HOLD_MS) strike(context, key.cls, key.code, key.isError, now);
      flushPreview(context, now);
    } catch {
      // Promise and event callbacks must not surface as console errors.
    }
  }

  function wake(context: AudioContext) {
    sleepWanted = false;
    try {
      settle(context.resume(), onState);
    } catch {
      // Old engines throw synchronously on a closed context.
    }
  }

  function armWatchdog(context: AudioContext) {
    if (watchdog !== undefined) return;
    const clockAtArm = context.currentTime;
    watchdog = setTimeout(() => {
      watchdog = undefined;
      if (context !== ctx || !everRunning || recreates >= MAX_RECREATES) return;
      if (context.state === "running" && context.currentTime !== clockAtArm) return;
      recreate(context);
    }, RECREATE_MS);
  }

  function abandon(context: AudioContext) {
    context.onstatechange = null;
    ctx = null;
    master = null;
    strips = [];
    held = null;
    closeQuietly(context);
  }

  function recreate(context: AudioContext) {
    recreates++;
    abandon(context);
    warm();
  }

  // A context that never ran is waiting on autoplay policy, not stuck. Recreating
  // it would be a retry loop of unbounded synchronous constructors, so the watchdog
  // needs everRunning, and resume() on each key is all it gets.
  function isHealthy(context: AudioContext, now: number): boolean {
    if (context.state !== "running") {
      wake(context);
      if (everRunning) armWatchdog(context);
      return false;
    }
    everRunning = true;
    const clock = context.currentTime;
    if (clock !== clockValue) {
      clockValue = clock;
      clockMovedAt = now;
      recreates = 0;
      return true;
    }
    if (now - clockMovedAt < STALL_MS) return true;
    if (watchdog === undefined) {
      // sleep() clears the watchdog, and this resume must not undo a deliberate sleep.
      settle(context.suspend(), () => {
        if (watchdog !== undefined) wake(context);
      });
      armWatchdog(context);
    }
    return false;
  }

  function armSleep() {
    if (idleTimer !== undefined) return;
    idleTimer = setTimeout(checkSleep, SLEEP_AFTER_MS);
  }

  function checkSleep() {
    idleTimer = undefined;
    const left = lastUseAt + SLEEP_AFTER_MS - performance.now();
    if (left <= 0) sleep();
    else idleTimer = setTimeout(checkSleep, left);
  }

  function pick(cls: RenderClass): AudioBuffer | undefined {
    const list = bank[cls];
    const count = list.length;
    if (count < 2) return list[0];
    let index = Math.floor(Math.random() * (count - 1));
    if (index >= lastVariant[cls]) index++;
    lastVariant[cls] = index;
    return list[index];
  }

  function voice(context: AudioContext, buffer: AudioBuffer, code: string, now: number) {
    // Wall clock, never currentTime: during a slow device start currentTime stalled
    // and 81 of 87 finished voices still read as playing, against 3 of 89 here.
    let strip: Strip | undefined;
    for (const candidate of strips) {
      if (!strip || candidate.endsAt < strip.endsAt) strip = candidate;
    }
    if (!strip) return;
    if (strip.endsAt > now) strip.source?.stop();

    const source = context.createBufferSource();
    const rate = 0.97 + Math.random() * 0.06;
    source.buffer = buffer;
    source.playbackRate.value = rate;
    source.connect(strip.gain);
    strip.gain.gain.value = 0.84 + Math.random() * 0.32;
    strip.pan.pan.value = prefs.spread
      ? panForCode(code) * PAN_WIDTH + (Math.random() * 2 - 1) * PAN_JITTER
      : 0;
    source.start();
    strip.source = source;
    strip.endsAt = now + (buffer.duration / rate) * 1000;
  }

  function strike(context: AudioContext, cls: KeyClass, code: string, isError: boolean, now: number) {
    if (now - lastStrikeAt < MIN_GAP_MS) return;
    lastStrikeAt = now;
    // Space and friends fall back to a key click while their buffers are still rendering.
    const buffer = pick(bank[cls].length ? cls : "key");
    if (!buffer) return;
    voice(context, buffer, code, now);
    if (isError && prefs.errorSound) {
      const under = pick("error");
      if (under) voice(context, under, code, now);
    }
    downs.add(code);
  }

  function flushPreview(context: AudioContext, now: number) {
    const wanted = wantedPreview;
    if (!wanted || context.state !== "running") return;
    wantedPreview = null;
    if (now - wanted.at > PREVIEW_HOLD_MS) return;
    voice(context, toBuffer(context, render(wanted.profile, "key", 0, context.sampleRate)), "", now);
  }

  // A suspended source keeps its place and would finish its tail on resume.
  function silence() {
    for (const strip of strips) {
      try {
        strip.source?.stop();
      } catch {
        // Every caller still has to suspend or close the context after this.
      }
      strip.source = null;
      strip.endsAt = 0;
    }
  }

  function sleep() {
    try {
      held = null;
      wantedPreview = null;
      clearTimeout(watchdog);
      watchdog = undefined;
      const context = ctx;
      if (!context) return;
      asleep = true;
      sleepWanted = true;
      silence();
      if (context.state === "running") settle(context.suspend());
    } catch {
      // Sleeping is an optimisation; failing to is not an error.
    }
  }

  const onBlur = () => {
    downs.clear();
    held = null;
  };
  const onVisibility = () => {
    if (document.hidden) sleep();
  };
  if (typeof window !== "undefined") window.addEventListener("blur", onBlur);
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);

  if (prefs.enabled) warm();

  return {
    press(cls, code, isError = false) {
      try {
        const context = ctx;
        if (!prefs.enabled || !context || !bank.key[0]) return;
        const now = performance.now();
        lastUseAt = now;
        armSleep();
        if (isHealthy(context, now)) strike(context, cls, code, isError, now);
        else held = { cls, code, isError, at: now };
      } catch {
        // Typing never pays for a sound failure.
      }
    },

    release(code) {
      try {
        const context = ctx;
        if (!downs.delete(code) || !context || !prefs.enabled || !prefs.release) return;
        if (context.state !== "running") return;
        const buffer = pick("up");
        if (buffer) voice(context, buffer, code, performance.now());
      } catch {
        // A release sound is never worth an exception in the keyup handler.
      }
    },

    unlock() {
      if (ctx && prefs.enabled && ctx.state !== "running") wake(ctx);
    },

    setPrefs(next) {
      try {
        const wasEnabled = prefs.enabled;
        // Partial allows an explicit undefined, which a spread would copy over the value.
        const defined = Object.entries(next).filter(([, value]) => value !== undefined);
        prefs = { ...prefs, ...Object.fromEntries(defined) };
        prefs.volume = clampVolume(prefs.volume);
        if (master) master.gain.value = prefs.volume * prefs.volume;
        if (prefs.enabled) {
          warm();
          fillBank();
        } else if (wasEnabled) {
          // Only the transition: a slider moved while off would cut off a preview.
          sleep();
        }
      } catch {
        // The engine is optional; a bad preference must not reach the UI.
      }
    },

    preview(profile = prefs.profile) {
      try {
        if (disposed || failed) return;
        wantedPreview = { profile, at: performance.now() };
        if (!ctx) {
          warm();
          return;
        }
        wake(ctx);
        flushPreview(ctx, performance.now());
      } catch {
        // Preview runs inside the UI's click handler.
      }
    },

    sleep,

    get status() {
      if (failed) return "failed";
      if (disposed || asleep || !prefs.enabled) return "suspended";
      return ctx && bank.key[0] ? "ready" : "warming";
    },

    latency() {
      const context = ctx as (AudioContext & { playbackStats?: { underrunEvents?: number } }) | null;
      return {
        baseMs: (context?.baseLatency ?? 0) * 1000,
        outputMs: (context?.outputLatency ?? 0) * 1000,
        underruns: context?.playbackStats?.underrunEvents ?? null,
      };
    },

    dispose() {
      try {
        disposed = true;
        clearTimeout(watchdog);
        clearTimeout(idleTimer);
        silence();
        if (typeof window !== "undefined") window.removeEventListener("blur", onBlur);
        if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
        const context = ctx;
        ctx = null;
        master = null;
        strips = [];
        bank = emptyBank();
        queue = [];
        held = null;
        wantedPreview = null;
        downs.clear();
        if (context) context.onstatechange = null;
        closeQuietly(context ?? undefined);
      } catch {
        // Remount must still work after a failed teardown.
      }
    },
  };
}

export function loadKeySound(prefs: SoundPrefs): Promise<KeySound> {
  return Promise.resolve(createKeySound(prefs));
}
