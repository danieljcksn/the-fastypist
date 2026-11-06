import { type Config, expire, init, type LogEntry, MAX_OPS, type State, step } from "@/engine/core";
import { configFor } from "@/engine/presets";
import { replay } from "@/engine/replay";
import { creditedChars, wpmCx } from "@/engine/score";
import type { KeyClass, KeySound, SoundProfile } from "@/sound/types";
import { attachCapture, type Capture } from "./capture";
import { afkFromGap, BROWSER_CLOCK, createCountdown, createIdleWatch, WORDS_IDLE_ABORT_MS } from "./clock";
import type { DeviceClass } from "./contract";
import { keyboardOffset } from "./keyboard-offset";
import type { KeyAction, KeyScope } from "./keymap";
import { applyTheme, defaultSettings, type TestSettings } from "./settings";
import type { HomeSnapshot, HomeStore } from "./store";
import { ensureText, localDay, newUuid, randomSeed, type RunText, textNow } from "./text";
import { createView } from "./view";

export interface SurfaceElements {
  root: HTMLElement;
  block: HTMLElement;
  viewport: HTMLElement;
  rows: HTMLElement;
  cursor: HTMLElement;
  ghost: HTMLElement;
  probe: HTMLElement;
  input: HTMLInputElement;
  number: HTMLElement;
  live: HTMLElement;
  upcoming: HTMLElement;
  status: HTMLElement;
}

export interface SessionStrings {
  secondsLeft: string;
  stoppedHidden: string;
  stoppedIdle: string;
  finished: string;
  soundOn: string;
  soundOff: string;
  listFailed: string;
  wpm: string;
}

// Enough to read ahead by, short enough that a screen reader isn't handed a paragraph on every word.
const UPCOMING_WORDS = 12;

// A live figure from under 2 s of typing is mostly noise, and it would flash a three-digit number on the first word.
const LIVE_MIN_MS = 2_000;

const ANNOUNCE_AT = new Set([30, 10]);

function idle(task: () => void): void {
  if (typeof requestIdleCallback === "function") requestIdleCallback(task, { timeout: 1_000 });
  else setTimeout(task, 32);
}

// A function so the narrowing from the top of onOp doesn't survive step(), which mutates the state.
function isFinished(state: State): boolean {
  return state.phase === "finished";
}

function afterPaint(task: () => void): void {
  requestAnimationFrame(() => setTimeout(task, 0));
}

/**
 * The whole run lives in this closure, created in an effect and undone by dispose. With cacheComponents a page stays
 * hidden-mounted, so anything kept in React state would come back stale on browser back.
 */
export function createSession(els: SurfaceElements, store: HomeStore, strings: SessionStrings): { dispose(): void } {
  const { root, input, number, live, upcoming, status } = els;
  const html = document.documentElement;
  const abort = new AbortController();
  const { signal } = abort;
  const view = createView(els);

  let disposed = false;
  let settings: TestSettings = store.get().settings;
  let soundPrefs = store.get().sound;
  let display = store.get().display;
  let cfg: Config = configFor(settings.mode);
  let seed = "";
  let text: RunText | null = null;
  let words: readonly string[] = [];
  let state: State = init();
  let entries: LogEntry[] = [];
  let deviceClass: DeviceClass = "keyboard";
  let afkMs = 0;
  let lastOpT = 0;
  let shownNumber = "";
  let loadToken = 0;

  let sound: KeySound | null = null;
  let keyClass: ((e: KeyboardEvent) => KeyClass | null) | null = null;
  let soundLoading = false;
  let wantedPreview: SoundProfile | null = null;

  function writeNumber(value: number) {
    const next = String(value);
    if (next !== shownNumber) {
      shownNumber = next;
      number.textContent = next;
    }
  }

  function writeUpcoming() {
    upcoming.textContent = words.slice(state.w, state.w + UPCOMING_WORDS).join(" ");
  }

  function setRunning(on: boolean) {
    if (on) html.dataset.typing = "";
    else delete html.dataset.typing;
  }

  const countdown = createCountdown(
    BROWSER_CLOCK,
    (seconds) => {
      writeNumber(seconds);
      if (ANNOUNCE_AT.has(seconds)) status.textContent = strings.secondsLeft.replace("{n}", String(seconds));
      writeLive();
    },
    () => {
      if (state.phase !== "running") return;
      expire(cfg, state);
      finish();
    },
  );

  const idleWatch = createIdleWatch(BROWSER_CLOCK, WORDS_IDLE_ABORT_MS, () => {
    if (state.phase === "running") stop(strings.stoppedIdle);
  });

  function writeLive() {
    if (!display.liveSpeed || state.phase !== "running") return;
    const origin = capture.origin();
    if (origin === null) return;
    const elapsed = performance.now() - origin - state.startT;
    if (elapsed < LIVE_MIN_MS) return;
    live.textContent = `${Math.round(wpmCx(creditedChars(cfg, words, state), elapsed) / 100)} ${strings.wpm}`;
  }

  function idleNumber(): number {
    if (settings.mode.kind === "time") return settings.mode.seconds;
    return words.length;
  }

  function begin(sameSeed: boolean) {
    countdown.stop();
    idleWatch.stop();
    if (!sameSeed || seed === "") seed = randomSeed();
    const next = textNow(settings, seed);
    if (!next) {
      const token = ++loadToken;
      const wanted = settings;
      ensureText(wanted).then(
        () => {
          if (token === loadToken && !disposed) begin(true);
        },
        () => {
          // A failed chunk after a deploy or offline: fall back to the list that arrived with the page.
          if (token !== loadToken || disposed) return;
          store.setSettings(defaultSettings(store.language));
          store.setNote(strings.listFailed);
        },
      );
      return;
    }
    loadToken++;
    text = next;
    words = next.words;
    cfg = configFor(settings.mode);
    state = init();
    entries = [];
    deviceClass = "keyboard";
    afkMs = 0;
    lastOpT = 0;
    capture.reset();
    capture.setFoldCAcute(settings.language === "pt");
    setRunning(false);
    root.dataset.phase = "idle";
    live.textContent = "";
    writeNumber(idleNumber());
    number.style.minWidth = `${shownNumber.length}ch`;
    writeUpcoming();
    view.setText(words, state);
    store.setCount(words.length);
    store.setPhase("idle");
  }

  function start() {
    setRunning(true);
    root.dataset.phase = "running";
    const origin = capture.origin();
    if (cfg.mode === "time" && origin !== null) countdown.start(origin + state.startT + cfg.durationMs);
    if (cfg.mode === "words") idleWatch.touch();
    // After paint, so React never shares the first keystroke's frame.
    afterPaint(() => {
      if (!disposed && state.phase === "running") store.setPhase("running");
    });
  }

  function stop(message: string | null) {
    if (message) status.textContent = message;
    begin(false);
  }

  function finish() {
    countdown.stop();
    idleWatch.stop();
    setRunning(false);
    if (cfg.mode === "time" && state.lastT < state.startT + cfg.durationMs) {
      afkMs += afkFromGap(state.startT + cfg.durationMs - lastOpT);
    }
    const run = replay(cfg, words, entries);
    // Too long and every other refusal land the same way: the run is not a result, so it leaves no trace.
    if (!run.valid || !text) {
      begin(false);
      return;
    }
    const finishedAt = Date.now();
    root.dataset.phase = "finished";
    status.textContent = strings.finished.replace("{n}", String(Math.round(run.score.wpm)));
    store.finish({
      id: newUuid(),
      finishedAt,
      mode: settings.mode,
      language: settings.language,
      packId: text.packId,
      quoteId: text.quoteId,
      punctuation: settings.punctuation,
      numbers: settings.numbers,
      accentFree: settings.accentFree,
      seed,
      wordsCount: words.length,
      words,
      entries,
      score: run.score,
      config: cfg,
      deviceClass,
      afkMs,
      localDay: localDay(finishedAt),
      drill: null,
    });
  }

  function onOp(op: LogEntry) {
    if (state.phase === "finished" || words.length === 0) return;
    if (state.phase === "idle" && (op.k === "s" || op.k === "b" || op.k === "w")) {
      // A stray key before the first letter is not the run's first key, so it must not set the time origin.
      capture.reset();
      return;
    }
    if (state.phase === "running" && cfg.mode === "time" && op.t >= state.startT + cfg.durationMs) {
      expire(cfg, state);
      finish();
      return;
    }
    if (entries.length >= MAX_OPS) {
      begin(false);
      return;
    }
    const wasIdle = state.phase === "idle";
    const wordBefore = state.w;
    const change = step(cfg, words, state, op);
    entries.push(op);
    if (!wasIdle) afkMs += afkFromGap(op.t - lastOpT);
    lastOpT = op.t;
    view.apply(change);
    view.place();
    if (wasIdle) start();
    else if (cfg.mode === "words") idleWatch.touch();
    if (state.w !== wordBefore) {
      writeUpcoming();
      if (cfg.mode === "words") writeNumber(words.length - state.w);
      if (display.liveSpeed && cfg.mode === "words") writeLive();
    }
    if (isFinished(state)) finish();
  }

  function focusInput() {
    input.focus({ preventScroll: true });
  }

  function focusChrome() {
    root.querySelector<HTMLElement>("[data-first-control]")?.focus({ preventScroll: true });
  }

  function onAction(action: KeyAction) {
    switch (action) {
      case "new-words":
      case "primary":
        begin(false);
        focusInput();
        return;
      case "abort":
        begin(entries.length === 0);
        focusInput();
        return;
      case "focus-chrome":
        focusChrome();
        return;
      case "focus-input":
        focusInput();
        return;
      case "toggle-sound":
        toggleSound();
        return;
      case "swallow":
        return;
    }
  }

  function toggleSound() {
    const enabled = !store.get().sound.enabled;
    store.setSound({ enabled });
    sound?.unlock();
    status.textContent = enabled ? strings.soundOn : strings.soundOff;
  }

  function loadSound() {
    if (soundLoading || sound) return;
    soundLoading = true;
    import("./sound-chunk").then(
      async (chunk) => {
        if (disposed) return;
        keyClass = chunk.keyClass;
        const loaded = await chunk.loadKeySound(store.get().sound);
        if (disposed) {
          loaded.dispose();
          return;
        }
        sound = loaded;
        soundLoading = false;
        if (wantedPreview) {
          loaded.preview(wantedPreview);
          wantedPreview = null;
        }
      },
      () => {
        // Typing never pays for a sound failure, and the next toggle tries again.
        soundLoading = false;
      },
    );
  }

  function wouldBeWrong(e: KeyboardEvent, cls: KeyClass): boolean {
    const target = words[state.w] ?? "";
    const typed = state.typed[state.w] ?? "";
    if (cls === "space") return typed.length > 0 && typed.length < target.length;
    return cls === "key" && e.key.length === 1 && target.charAt(typed.length) !== e.key;
  }

  const scope = (): KeyScope => (state.phase === "finished" ? "finished" : state.phase);

  const capture: Capture = attachCapture(
    input,
    {
      op: onOp,
      action: onAction,
      caps(on) {
        root.toggleAttribute("data-caps", on);
      },
      pending(diacritic) {
        view.pending(diacritic);
      },
      focus(on) {
        root.toggleAttribute("data-blur", !on);
      },
      virtual() {
        deviceClass = "touch";
      },
    },
    {
      press(e) {
        if (sound === null || e.repeat) return;
        if (state.phase === "finished" || store.get().menu !== null || (e.altKey && e.code === "KeyM")) return;
        const cls = keyClass?.(e) ?? null;
        if (cls === null) return;
        const active = document.activeElement;
        if (active !== input && active !== document.body && cls !== "key") return;
        sound.press(cls, e.code, soundPrefs.errorSound && wouldBeWrong(e, cls));
      },
      release(e) {
        sound?.release(e.code);
      },
      scope,
      overlayOpen: () => store.get().menu !== null,
    },
    { win: window, doc: document },
  );

  store.attach({
    newWords() {
      begin(false);
      focusInput();
    },
    toggleSound,
    previewSound(profile) {
      if (sound) sound.preview(profile);
      else {
        wantedPreview = profile;
        loadSound();
      }
    },
    focusInput,
    focusTrigger(id) {
      // Scoped to this page's root: a hidden-mounted page holds another element with the same attribute.
      root.querySelector<HTMLElement>(`[data-menu-trigger="${id}"]`)?.focus({ preventScroll: true });
    },
  });

  function onStore(next: HomeSnapshot) {
    if (next.settings !== settings) {
      settings = next.settings;
      begin(false);
    }
    if (next.sound !== soundPrefs) {
      soundPrefs = next.sound;
      sound?.setPrefs(soundPrefs);
      if (soundPrefs.enabled) idle(loadSound);
    }
    display = next.display;
  }
  const unsubscribe = store.subscribe(() => onStore(store.get()));

  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden && state.phase === "running") stop(strings.stoppedHidden);
    },
    { signal },
  );

  // One handler for mouse and touch: iOS only opens the keyboard for a focus inside the gesture, and audio unlocks with it.
  els.block.addEventListener(
    "click",
    (e) => {
      if ((e.target as Element).closest("button,a,input,[role='dialog']")) return;
      focusInput();
      sound?.unlock();
    },
    { signal },
  );

  const lightScheme = matchMedia("(prefers-color-scheme: light)");
  lightScheme.addEventListener(
    "change",
    () => {
      if (store.get().theme === "system") applyTheme("system", html);
    },
    { signal },
  );

  const vv = window.visualViewport;
  if (vv) {
    const fit = () => {
      els.block.style.transform = "";
      if (vv.height > window.innerHeight * 0.85) return;
      const box = els.viewport.getBoundingClientRect();
      const offset = keyboardOffset(box.top, box.bottom, vv.offsetTop, vv.height);
      els.block.style.transform = offset === 0 ? "" : `translateY(${Math.round(offset)}px)`;
    };
    vv.addEventListener("resize", fit, { signal });
  }

  if (location.search.includes("debug=1")) {
    void import("./debug-hud").then(({ mountHud }) => {
      if (!disposed) signal.addEventListener("abort", mountHud(() => sound?.latency() ?? null));
    });
  }

  if (!matchMedia("(pointer: coarse)").matches) focusInput();
  begin(false);
  if (soundPrefs.enabled) idle(loadSound);

  return {
    dispose() {
      disposed = true;
      abort.abort();
      unsubscribe();
      store.attach(null);
      countdown.stop();
      idleWatch.stop();
      capture.dispose();
      view.dispose();
      sound?.dispose();
      sound = null;
      setRunning(false);
      root.removeAttribute("data-caps");
      root.removeAttribute("data-blur");
      root.dataset.phase = "idle";
      input.value = "";
      els.block.style.transform = "";
      upcoming.textContent = "";
      status.textContent = "";
      live.textContent = "";
      store.reset();
    },
  };
}
