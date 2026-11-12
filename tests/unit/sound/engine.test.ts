import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadKeySound, panForCode } from "@/sound/engine";
import { DEFAULT_SOUND_PREFS, type KeySound, type SoundPrefs } from "@/sound/types";

class MockParam {
  value = 1;
}

class MockNode {
  outputs: MockNode[] = [];
  constructor(readonly name: string) {}
  connect(target: MockNode) {
    this.outputs.push(target);
    return target;
  }
}

class MockGain extends MockNode {
  gain = new MockParam();
  constructor() {
    super("gain");
  }
}

class MockPanner extends MockNode {
  pan = new MockParam();
  constructor() {
    super("panner");
  }
}

class MockShaper extends MockNode {
  oversample = "4x";
  curve: Float32Array | null = null;
  constructor() {
    super("shaper");
  }
}

class MockSource extends MockNode {
  buffer: { duration: number } | null = null;
  playbackRate = new MockParam();
  started = 0;
  stopped = 0;
  constructor() {
    super("source");
  }
  start() {
    this.started++;
  }
  stop() {
    this.stopped++;
  }
}

class MockContext {
  static instances: MockContext[] = [];
  static initialState: AudioContextState = "running";
  static autoResume = true;
  static throwOnConstruct = false;

  state: AudioContextState = MockContext.initialState;
  currentTime = 0;
  sampleRate = 48000;
  baseLatency = 0.005;
  outputLatency = 0.02;
  destination = new MockNode("destination");
  onstatechange: (() => void) | null = null;
  sources: MockSource[] = [];
  gains: MockGain[] = [];
  panners: MockPanner[] = [];
  shapers: MockShaper[] = [];
  buffers: { duration: number; length: number; data: Float32Array }[] = [];
  resumeCalls = 0;
  suspendCalls = 0;
  closeCalls = 0;
  throwOnSource = false;
  log: string[] = [];

  constructor() {
    if (MockContext.throwOnConstruct) throw new Error("no device");
    MockContext.instances.push(this);
  }
  createGain() {
    const node = new MockGain();
    this.gains.push(node);
    return node;
  }
  createStereoPanner() {
    const node = new MockPanner();
    this.panners.push(node);
    return node;
  }
  createWaveShaper() {
    const node = new MockShaper();
    this.shapers.push(node);
    return node;
  }
  createDynamicsCompressor(): never {
    throw new Error("the ruling bans DynamicsCompressorNode");
  }
  createBufferSource() {
    if (this.throwOnSource) throw new Error("boom");
    const node = new MockSource();
    this.sources.push(node);
    return node;
  }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length);
    const buffer = { duration: length / sampleRate, length, data, getChannelData: () => data };
    this.buffers.push(buffer);
    return buffer;
  }
  setState(state: AudioContextState) {
    this.state = state;
    this.onstatechange?.();
  }
  resume() {
    this.resumeCalls++;
    this.log.push("resume");
    if (MockContext.autoResume) this.setState("running");
    return Promise.resolve();
  }
  suspend() {
    this.suspendCalls++;
    this.log.push("suspend");
    this.setState("suspended");
    return Promise.resolve();
  }
  close() {
    this.closeCalls++;
    this.state = "closed";
    return Promise.resolve();
  }
}

let idleQueue: (() => void)[] = [];
let context: () => MockContext;

function runIdle(count = 1) {
  for (let i = 0; i < count; i++) idleQueue.shift()?.();
}

function runAllIdle() {
  while (idleQueue.length) idleQueue.shift()?.();
}

const load = (prefs: Partial<SoundPrefs> = {}) => loadKeySound({ ...DEFAULT_SOUND_PREFS, enabled: true, ...prefs });

async function ready(prefs: Partial<SoundPrefs> = {}): Promise<KeySound> {
  const sound = await load(prefs);
  runAllIdle();
  return sound;
}

function advance(ms: number) {
  vi.advanceTimersByTime(ms);
  // The audio clock keeps moving unless a test freezes it.
  const ctx = MockContext.instances.at(-1);
  if (ctx && ctx.state === "running") ctx.currentTime += ms / 1000;
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

const started = (ctx: MockContext) => ctx.sources.filter((source) => source.started > 0);

beforeEach(() => {
  MockContext.instances = [];
  MockContext.initialState = "running";
  MockContext.autoResume = true;
  MockContext.throwOnConstruct = false;
  idleQueue = [];
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  vi.stubGlobal("AudioContext", MockContext);
  vi.stubGlobal("requestIdleCallback", (task: () => void) => idleQueue.push(task));
  context = () => {
    const ctx = MockContext.instances.at(-1);
    if (!ctx) throw new Error("no context was constructed");
    return ctx;
  };
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("loading", () => {
  it("constructs nothing when sound is off", async () => {
    const sound = await load({ enabled: false });
    runAllIdle();
    expect(MockContext.instances).toHaveLength(0);
    expect(idleQueue).toHaveLength(0);
    sound.press("key", "KeyA");
    sound.unlock();
    runAllIdle();
    expect(MockContext.instances).toHaveLength(0);
    expect(sound.status).toBe("suspended");
  });

  it("constructs the context on idle, never in the load or on a keystroke", async () => {
    const sound = await load();
    expect(MockContext.instances).toHaveLength(0);
    expect(sound.status).toBe("warming");
    sound.press("key", "KeyA");
    sound.unlock();
    expect(MockContext.instances).toHaveLength(0);
    runIdle();
    expect(MockContext.instances).toHaveLength(1);
  });

  it("is a no-op until the first buffer exists", async () => {
    const sound = await load();
    sound.press("key", "KeyA");
    runIdle();
    const ctx = context();
    expect(ctx.buffers).toHaveLength(0);
    expect(sound.status).toBe("warming");
    sound.press("key", "KeyA");
    expect(ctx.sources).toHaveLength(0);
    runIdle();
    expect(sound.status).toBe("ready");
    sound.press("key", "KeyA");
    expect(started(ctx)).toHaveLength(1);
  });

  it("renders 25 buffers one per idle callback, key class first", async () => {
    await load();
    runIdle();
    const ctx = context();
    const lengths: number[] = [];
    for (let i = 1; i <= 25; i++) {
      runIdle();
      expect(ctx.buffers).toHaveLength(i);
      lengths.push(ctx.buffers.at(-1)?.length ?? 0);
    }
    expect(idleQueue).toHaveLength(0);
    // soft key variants last 60 to 71 ms at 48 kHz, and space never fits that.
    expect(lengths.slice(0, 8).every((length) => length >= 2880 && length <= 3408)).toBe(true);
    expect(lengths[8]).toBeGreaterThan(3408);
  });

  it("asks for a deadline, because idle callbacks can starve", async () => {
    const options: (IdleRequestOptions | undefined)[] = [];
    vi.stubGlobal("requestIdleCallback", (task: () => void, option?: IdleRequestOptions) => {
      options.push(option);
      idleQueue.push(task);
    });
    await ready();
    expect(options).toHaveLength(26);
    expect(options.every((option) => (option?.timeout ?? 0) > 0)).toBe(true);
  });

  it("falls back to setTimeout where requestIdleCallback is missing", async () => {
    vi.stubGlobal("requestIdleCallback", undefined);
    await load();
    expect(MockContext.instances).toHaveLength(0);
    vi.advanceTimersByTime(40);
    expect(MockContext.instances).toHaveLength(1);
  });

  it("sets an ambient audio session where one exists", async () => {
    const audioSession = { type: "auto" };
    vi.stubGlobal("navigator", { audioSession });
    await ready();
    expect(audioSession.type).toBe("ambient");
  });
});

describe("no AudioContext", () => {
  it("fails silently when the constructor is missing", async () => {
    vi.stubGlobal("AudioContext", undefined);
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");
    const sound = await load();
    runAllIdle();
    expect(sound.status).toBe("failed");
    exerciseEverything(sound);
    expect(sound.status).toBe("failed");
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("fails silently when the constructor throws", async () => {
    MockContext.throwOnConstruct = true;
    const sound = await load();
    expect(() => runAllIdle()).not.toThrow();
    expect(sound.status).toBe("failed");
    exerciseEverything(sound);
  });

  it("stays failed when sound is enabled later", async () => {
    vi.stubGlobal("AudioContext", undefined);
    const sound = await load({ enabled: false });
    sound.setPrefs({ enabled: true });
    expect(sound.status).toBe("failed");
  });
});

function exerciseEverything(sound: KeySound) {
  expect(() => {
    sound.press("key", "KeyA");
    sound.press("space", "Space", true);
    sound.release("KeyA");
    sound.unlock();
    sound.setPrefs({ volume: 0.3, profile: "pop" });
    sound.preview();
    sound.sleep();
    sound.latency();
    sound.dispose();
  }).not.toThrow();
  runAllIdle();
}

describe("graph", () => {
  it("wires source, strip gain, panner, master, pre-gain, shaper, destination", async () => {
    const sound = await ready({ volume: 0.5 });
    const ctx = context();
    sound.press("key", "KeyA");
    const source = ctx.sources[0];
    const strip = source?.outputs[0] as MockGain;
    const panner = strip.outputs[0] as MockPanner;
    const master = panner.outputs[0] as MockGain;
    const pre = master.outputs[0] as MockGain;
    const shaper = pre.outputs[0] as MockShaper;
    expect([strip.name, panner.name, master.name, pre.name, shaper.name]).toEqual([
      "gain",
      "panner",
      "gain",
      "gain",
      "shaper",
    ]);
    expect(shaper.outputs[0]).toBe(ctx.destination);
    expect(master.gain.value).toBe(0.25);
    expect(pre.gain.value).toBe(0.5);
    expect(shaper.oversample).toBe("none");
    expect(shaper.curve).toHaveLength(4097);
  });

  it("pools 6 strips and creates only a source per play", async () => {
    const sound = await ready();
    const ctx = context();
    expect(ctx.panners).toHaveLength(6);
    const gains = ctx.gains.length;
    for (let i = 0; i < 40; i++) {
      sound.press("key", "KeyA");
      advance(10);
    }
    expect(ctx.panners).toHaveLength(6);
    expect(ctx.gains).toHaveLength(gains);
    expect(new Set(ctx.sources).size).toBe(40);
  });

  it("sets gain to volume squared and clamps garbage", async () => {
    const sound = await ready({ volume: 1 });
    const master = context().panners[0]?.outputs[0] as MockGain;
    expect(master.gain.value).toBe(1);
    sound.setPrefs({ volume: 0.3 });
    expect(master.gain.value).toBeCloseTo(0.09, 9);
    sound.setPrefs({ volume: 7 });
    expect(master.gain.value).toBe(1);
    sound.setPrefs({ volume: Number.NaN });
    expect(master.gain.value).toBe(0);
    sound.setPrefs({ volume: -1 });
    expect(master.gain.value).toBe(0);
  });
});

describe("gap", () => {
  it("drops a press closer than 8 ms to the last sound", async () => {
    const sound = await ready();
    const ctx = context();
    sound.press("key", "KeyA");
    advance(7);
    sound.press("key", "KeyB");
    expect(started(ctx)).toHaveLength(1);
    advance(1);
    sound.press("key", "KeyC");
    expect(started(ctx)).toHaveLength(2);
  });

  it("measures from the last sound played, not the last press", async () => {
    const sound = await ready();
    const ctx = context();
    sound.press("key", "KeyA");
    advance(5);
    sound.press("key", "KeyB");
    advance(5);
    sound.press("key", "KeyC");
    expect(started(ctx)).toHaveLength(2);
  });

  it("leaves a palm mash at one sound", async () => {
    const sound = await ready();
    for (const code of ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH"]) sound.press("key", code);
    expect(started(context())).toHaveLength(1);
  });

  it("does not apply to release sounds", async () => {
    const sound = await ready();
    const ctx = context();
    sound.press("key", "KeyA");
    sound.release("KeyA");
    expect(started(ctx)).toHaveLength(2);
    advance(8);
    sound.press("key", "KeyB");
    expect(started(ctx)).toHaveLength(3);
  });
});

describe("voice stealing", () => {
  it("steals the voice ending soonest once all 6 are busy", async () => {
    const sound = await ready();
    const ctx = context();
    for (let i = 0; i < 6; i++) {
      sound.press("key", "KeyA");
      advance(8);
    }
    expect(ctx.sources.every((source) => source.stopped === 0)).toBe(true);
    sound.press("key", "KeyA");
    const stopped = ctx.sources.filter((source) => source.stopped > 0);
    expect(stopped).toHaveLength(1);
    expect(ctx.sources[6]?.outputs[0]).toBe(stopped[0]?.outputs[0]);
  });

  it("frees voices by the wall clock while currentTime stands still", async () => {
    const sound = await ready();
    const ctx = context();
    for (let i = 0; i < 6; i++) {
      sound.press("key", "KeyA");
      vi.advanceTimersByTime(8);
    }
    // Longest click at the slowest rate is under 74 ms; the clock never moved.
    vi.advanceTimersByTime(90);
    expect(ctx.currentTime).toBe(0);
    sound.press("key", "KeyA");
    expect(started(ctx)).toHaveLength(7);
    expect(ctx.sources.every((source) => source.stopped === 0)).toBe(true);
  });

  it("does not grow past 6 live voices over a long run", async () => {
    const sound = await ready();
    const ctx = context();
    for (let i = 0; i < 2000; i++) {
      sound.press("key", "KeyA");
      sound.release("KeyA");
      advance(30);
    }
    expect(ctx.panners).toHaveLength(6);
    expect(new Set(ctx.sources.map((source) => source.outputs[0])).size).toBe(6);
  });
});

describe("variation", () => {
  it("never repeats a variant immediately", async () => {
    const sound = await ready();
    const ctx = context();
    for (let i = 0; i < 400; i++) {
      sound.press("key", "KeyA");
      advance(9);
    }
    const played = ctx.sources.map((source) => source.buffer);
    expect(new Set(played).size).toBe(8);
    played.forEach((buffer, i) => {
      if (i > 0) expect(buffer).not.toBe(played[i - 1]);
    });
  });

  it("holds at the extremes of Math.random", async () => {
    const sound = await ready();
    const ctx = context();
    const random = vi.spyOn(Math, "random");
    for (const value of [0, 0.999999, 0, 0, 0.999999, 0.999999]) {
      random.mockReturnValue(value);
      sound.press("space", "Space");
      advance(9);
    }
    const played = ctx.sources.map((source) => source.buffer);
    expect(played).toHaveLength(6);
    played.forEach((buffer, i) => {
      if (i > 0) expect(buffer).not.toBe(played[i - 1]);
    });
    expect(played.every(Boolean)).toBe(true);
  });

  it("jitters rate within 0.97 to 1.03 and gain within 0.84 to 1.16", async () => {
    const sound = await ready();
    const ctx = context();
    const gains: number[] = [];
    for (let i = 0; i < 300; i++) {
      sound.press("key", "KeyA");
      const strip = ctx.sources.at(-1)?.outputs[0] as MockGain;
      gains.push(strip.gain.value);
      advance(9);
    }
    const rates = ctx.sources.map((source) => source.playbackRate.value);
    expect(Math.min(...rates)).toBeGreaterThanOrEqual(0.97);
    expect(Math.max(...rates)).toBeLessThanOrEqual(1.03);
    expect(Math.max(...rates) - Math.min(...rates)).toBeGreaterThan(0.04);
    expect(Math.min(...gains)).toBeGreaterThanOrEqual(0.84);
    expect(Math.max(...gains)).toBeLessThanOrEqual(1.16);
    expect(Math.max(...gains) - Math.min(...gains)).toBeGreaterThan(0.2);
  });
});

describe("pan", () => {
  it("maps physical codes left to right, Intl keys included, unknown to 0", () => {
    expect(panForCode("KeyQ")).toBeLessThan(panForCode("KeyT"));
    expect(panForCode("KeyT")).toBeLessThan(panForCode("KeyP"));
    expect(panForCode("KeyA")).toBeLessThan(0);
    expect(panForCode("KeyL")).toBeGreaterThan(0);
    expect(panForCode("IntlBackslash")).toBeLessThan(panForCode("KeyZ"));
    expect(panForCode("IntlRo")).toBeGreaterThan(panForCode("Slash"));
    expect(panForCode("IntlYen")).toBeGreaterThan(panForCode("Equal"));
    expect(panForCode("Numpad4")).toBe(1);
    expect(panForCode("NumpadComma")).toBe(1);
    expect(panForCode("Space")).toBe(0);
    expect(panForCode("")).toBe(0);
    expect(panForCode("MysteryKey")).toBe(0);
    expect(panForCode("constructor")).toBe(0);
  });

  it("covers every typing key inside -1..1", () => {
    const codes = [
      ..."QWERTYUIOPASDFGHJKLZXCVBNM".split("").map((letter) => `Key${letter}`),
      ..."0123456789".split("").map((digit) => `Digit${digit}`),
      "Backquote",
      "Minus",
      "Equal",
      "BracketLeft",
      "BracketRight",
      "Backslash",
      "Semicolon",
      "Quote",
      "Comma",
      "Period",
      "Slash",
      "Backspace",
      "Enter",
      "IntlBackslash",
      "IntlRo",
      "IntlYen",
      "Convert",
      "NonConvert",
      "KanaMode",
      "Lang1",
      "Lang2",
    ];
    for (const code of codes) {
      expect(Math.abs(panForCode(code)), code).toBeLessThanOrEqual(1);
      // Digit7 is the one key whose centre is the middle of the block.
      if (code !== "Digit7") expect(panForCode(code), code).not.toBe(0);
    }
  });

  it("scales by 0.35 with 0.03 jitter when spread is on", async () => {
    const sound = await ready();
    const ctx = context();
    for (let i = 0; i < 200; i++) {
      sound.press("key", "KeyQ");
      const panner = (ctx.sources.at(-1)?.outputs[0] as MockGain).outputs[0] as MockPanner;
      expect(Math.abs(panner.pan.value - panForCode("KeyQ") * 0.35)).toBeLessThanOrEqual(0.03);
      advance(9);
    }
  });

  it("is exactly centre when spread is off", async () => {
    const sound = await ready({ spread: false });
    const ctx = context();
    sound.press("key", "KeyQ");
    expect(((ctx.sources[0]?.outputs[0] as MockGain).outputs[0] as MockPanner).pan.value).toBe(0);
  });
});

describe("release", () => {
  const lengthOf = (source: MockSource | undefined) => source?.buffer?.duration ?? 0;

  it("plays the up sound only for a code that played down", async () => {
    const sound = await ready();
    const ctx = context();
    sound.release("KeyA");
    expect(ctx.sources).toHaveLength(0);
    sound.press("key", "KeyA");
    sound.release("KeyA");
    expect(started(ctx)).toHaveLength(2);
    // Up variants are 31 to 33 ms, key variants 60 to 71.
    expect(lengthOf(ctx.sources[1])).toBeLessThan(lengthOf(ctx.sources[0]));
    sound.release("KeyA");
    expect(started(ctx)).toHaveLength(2);
  });

  it("stays silent for a press the gap dropped", async () => {
    const sound = await ready();
    const ctx = context();
    sound.press("key", "KeyA");
    sound.press("key", "KeyB");
    sound.release("KeyB");
    expect(started(ctx)).toHaveLength(1);
  });

  it("forgets downs on blur", async () => {
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    const sound = await ready();
    const ctx = context();
    sound.press("key", "KeyA");
    target.dispatchEvent(new Event("blur"));
    sound.release("KeyA");
    expect(started(ctx)).toHaveLength(1);
  });

  it("respects the release preference", async () => {
    const sound = await ready({ release: false });
    const ctx = context();
    sound.press("key", "KeyA");
    sound.release("KeyA");
    expect(started(ctx)).toHaveLength(1);
  });
});

describe("error sound", () => {
  it("is layered under the click only when the preference is on", async () => {
    const sound = await ready();
    const ctx = context();
    sound.press("key", "KeyA", true);
    expect(started(ctx)).toHaveLength(1);
    sound.setPrefs({ errorSound: true });
    advance(9);
    sound.press("key", "KeyA", false);
    expect(started(ctx)).toHaveLength(2);
    advance(9);
    sound.press("key", "KeyA", true);
    expect(started(ctx)).toHaveLength(4);
    // Error variants are at least 108 ms, longer than any key variant.
    expect(ctx.sources[3]?.buffer?.duration).toBeGreaterThan(0.1);
  });
});

describe("first key after unlock", () => {
  beforeEach(() => {
    MockContext.initialState = "suspended";
    MockContext.autoResume = false;
  });

  it("plays the held key when running arrives within 50 ms", async () => {
    const sound = await ready();
    const ctx = context();
    sound.press("key", "KeyA");
    expect(ctx.resumeCalls).toBe(1);
    expect(ctx.sources).toHaveLength(0);
    vi.advanceTimersByTime(50);
    ctx.setState("running");
    expect(started(ctx)).toHaveLength(1);
  });

  it("drops the held key when running arrives later", async () => {
    const sound = await ready();
    const ctx = context();
    sound.press("key", "KeyA");
    vi.advanceTimersByTime(51);
    ctx.setState("running");
    expect(ctx.sources).toHaveLength(0);
    sound.release("KeyA");
    expect(ctx.sources).toHaveLength(0);
  });

  it("does not play the held key twice when the promise and the event both fire", async () => {
    MockContext.autoResume = true;
    const sound = await ready();
    const ctx = context();
    sound.press("key", "KeyA");
    await flush();
    expect(started(ctx)).toHaveLength(1);
  });

  it("forgets the held key on blur", async () => {
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    const sound = await ready();
    const ctx = context();
    sound.press("key", "KeyA");
    target.dispatchEvent(new Event("blur"));
    ctx.setState("running");
    expect(ctx.sources).toHaveLength(0);
  });

  it("calls resume from unlock", async () => {
    const sound = await ready();
    const ctx = context();
    sound.unlock();
    expect(ctx.resumeCalls).toBe(1);
    expect(ctx.sources).toHaveLength(0);
  });

  it("does not resume from unlock while sound is off", async () => {
    const sound = await ready();
    const ctx = context();
    sound.setPrefs({ enabled: false });
    sound.unlock();
    expect(ctx.resumeCalls).toBe(0);
  });
});

describe("recovery", () => {
  async function runningThenStalled() {
    const sound = await ready();
    const ctx = context();
    sound.press("key", "KeyA");
    advance(10);
    sound.press("key", "KeyB");
    return { sound, ctx };
  }

  it("resumes on every key while not running", async () => {
    const sound = await ready();
    const ctx = context();
    MockContext.autoResume = false;
    ctx.setState("interrupted" as AudioContextState);
    sound.press("key", "KeyA");
    advance(10);
    sound.press("key", "KeyB");
    expect(ctx.resumeCalls).toBe(2);
    expect(sound.status).toBe("suspended");
  });

  it("suspends then resumes a running context whose clock stalled across 150 ms", async () => {
    const { sound, ctx } = await runningThenStalled();
    const before = started(ctx).length;
    vi.advanceTimersByTime(149);
    sound.press("key", "KeyC");
    expect(ctx.suspendCalls).toBe(0);
    expect(started(ctx)).toHaveLength(before + 1);

    vi.advanceTimersByTime(1);
    sound.press("key", "KeyD");
    await flush();
    expect(ctx.log.slice(-2)).toEqual(["suspend", "resume"]);
  });

  it("keeps a stalled press only for the hold window", async () => {
    const { sound, ctx } = await runningThenStalled();
    const before = started(ctx).length;
    vi.advanceTimersByTime(200);
    sound.press("key", "KeyC");
    expect(started(ctx)).toHaveLength(before);
    await flush();
    // The nudge took no wall time, so the held key made it.
    expect(started(ctx)).toHaveLength(before + 1);
  });

  it("closes and recreates in a later task when the clock stays stalled", async () => {
    const { sound, ctx } = await runningThenStalled();
    vi.advanceTimersByTime(200);
    sound.press("key", "KeyC");
    await flush();
    expect(MockContext.instances).toHaveLength(1);
    vi.advanceTimersByTime(499);
    expect(ctx.closeCalls).toBe(0);
    vi.advanceTimersByTime(1);
    expect(ctx.closeCalls).toBe(1);
    expect(MockContext.instances).toHaveLength(1);
    runIdle();
    expect(MockContext.instances).toHaveLength(2);
    expect(context().sampleRate).toBe(ctx.sampleRate);
  });

  it("carries buffers across a recreate at the same sample rate", async () => {
    const { sound, ctx } = await runningThenStalled();
    const rendered = ctx.buffers.length;
    vi.advanceTimersByTime(200);
    sound.press("key", "KeyC");
    await flush();
    vi.advanceTimersByTime(500);
    runAllIdle();
    const next = context();
    expect(next).not.toBe(ctx);
    expect(next.buffers).toHaveLength(0);
    expect(rendered).toBe(25);
    sound.press("key", "KeyD");
    expect(started(next)).toHaveLength(1);
    expect(ctx.buffers).toContain(next.sources[0]?.buffer);
  });

  it("re-renders across a recreate when the sample rate changed", async () => {
    const { sound, ctx } = await runningThenStalled();
    vi.advanceTimersByTime(200);
    sound.press("key", "KeyC");
    await flush();
    vi.advanceTimersByTime(500);
    const Original = MockContext;
    vi.stubGlobal(
      "AudioContext",
      class extends Original {
        override sampleRate = 44100;
      },
    );
    runAllIdle();
    const next = context();
    expect(next).not.toBe(ctx);
    expect(next.buffers).toHaveLength(25);
    expect(next.buffers[0]?.duration).toBeCloseTo((next.buffers[0]?.length ?? 0) / 44100, 9);
  });

  it("closes a context whose resume never settles, once it had run", async () => {
    const sound = await ready();
    const ctx = context();
    sound.press("key", "KeyA");
    advance(10);
    MockContext.autoResume = false;
    ctx.state = "interrupted" as AudioContextState;
    sound.press("key", "KeyB");
    vi.advanceTimersByTime(500);
    expect(ctx.closeCalls).toBe(1);
  });

  it("leaves a recovered context alone", async () => {
    const sound = await ready();
    const ctx = context();
    sound.press("key", "KeyA");
    MockContext.autoResume = false;
    ctx.state = "interrupted" as AudioContextState;
    sound.press("key", "KeyB");
    vi.advanceTimersByTime(100);
    ctx.setState("running");
    ctx.currentTime += 0.1;
    vi.advanceTimersByTime(450);
    expect(ctx.closeCalls).toBe(0);
    expect(sound.status).toBe("ready");
  });

  it("never recreates a context the autoplay policy holds, so there is no retry loop", async () => {
    MockContext.initialState = "suspended";
    MockContext.autoResume = false;
    const sound = await ready();
    const ctx = context();
    for (let i = 0; i < 20; i++) {
      sound.press("key", "KeyA");
      vi.advanceTimersByTime(600);
      runAllIdle();
    }
    expect(MockContext.instances).toHaveLength(1);
    expect(ctx.closeCalls).toBe(0);
    expect(ctx.resumeCalls).toBe(20);
  });

  it("caps recreates while contexts keep stalling", async () => {
    const sound = await ready();
    sound.press("key", "KeyA");
    for (let i = 0; i < 12; i++) {
      vi.advanceTimersByTime(200);
      sound.press("key", "KeyB");
      await flush();
      vi.advanceTimersByTime(500);
      runAllIdle();
      context().state = "running";
      vi.advanceTimersByTime(1);
    }
    expect(MockContext.instances).toHaveLength(3);
  });
});

describe("sleep", () => {
  it("suspends after 30 s idle and wakes on the next key", async () => {
    const sound = await ready();
    const ctx = context();
    sound.press("key", "KeyA");
    vi.advanceTimersByTime(29_999);
    expect(ctx.suspendCalls).toBe(0);
    vi.advanceTimersByTime(1);
    expect(ctx.suspendCalls).toBe(1);
    expect(sound.status).toBe("suspended");

    MockContext.autoResume = false;
    sound.press("key", "KeyB");
    expect(ctx.resumeCalls).toBe(1);
    ctx.setState("running");
    expect(started(ctx)).toHaveLength(2);
    expect(sound.status).toBe("ready");
  });

  it("counts idle from the last key, not the first", async () => {
    const sound = await ready();
    const ctx = context();
    sound.press("key", "KeyA");
    advance(20_000);
    sound.press("key", "KeyB");
    advance(20_000);
    expect(ctx.suspendCalls).toBe(0);
    advance(10_000);
    expect(ctx.suspendCalls).toBe(1);
  });

  it("suspends a context that started running and never heard a key", async () => {
    await ready();
    vi.advanceTimersByTime(30_000);
    expect(context().suspendCalls).toBe(1);
  });

  it("suspends a resume that lands after sound went off", async () => {
    MockContext.autoResume = false;
    const sound = await ready();
    const ctx = context();
    sound.setPrefs({ enabled: false });
    sound.setPrefs({ enabled: true });
    sound.unlock();
    expect(ctx.state).toBe("suspended");
    sound.setPrefs({ enabled: false });
    ctx.setState("running");
    expect(ctx.state).toBe("suspended");
    expect(sound.status).toBe("suspended");
  });

  it("suspends when the page is hidden, and not on a transition to visible", async () => {
    const target = Object.assign(new EventTarget(), { hidden: false });
    vi.stubGlobal("document", target);
    const sound = await ready();
    const ctx = context();
    target.dispatchEvent(new Event("visibilitychange"));
    expect(ctx.suspendCalls).toBe(0);
    target.hidden = true;
    target.dispatchEvent(new Event("visibilitychange"));
    expect(ctx.suspendCalls).toBe(1);
    expect(sound.status).toBe("suspended");
  });

  it("stops tails so they do not finish on resume", async () => {
    const sound = await ready();
    const ctx = context();
    sound.press("key", "KeyA");
    sound.sleep();
    expect(ctx.sources[0]?.stopped).toBe(1);
  });

  it.each([
    ["sleep", (sound: KeySound) => sound.sleep()],
    ["mute", (sound: KeySound) => sound.setPrefs({ enabled: false })],
  ])("does not let a stall nudge resume after %s", async (_name, stop) => {
    const sound = await ready();
    const ctx = context();
    sound.press("key", "KeyA");
    advance(10);
    sound.press("key", "KeyB");
    vi.advanceTimersByTime(200);
    sound.press("key", "KeyC");
    stop(sound);
    await flush();
    expect(ctx.state).toBe("suspended");
    expect(sound.status).toBe("suspended");
  });

  it("does not let the stall watchdog fire after a deliberate sleep", async () => {
    const sound = await ready();
    const ctx = context();
    sound.press("key", "KeyA");
    vi.advanceTimersByTime(200);
    sound.press("key", "KeyB");
    sound.sleep();
    vi.advanceTimersByTime(1000);
    expect(ctx.closeCalls).toBe(0);
  });
});

describe("prefs", () => {
  it("off silences press and keeps the context", async () => {
    const sound = await ready();
    const ctx = context();
    sound.setPrefs({ enabled: false });
    sound.press("key", "KeyA");
    expect(ctx.sources).toHaveLength(0);
    expect(ctx.closeCalls).toBe(0);
    expect(ctx.suspendCalls).toBe(1);
  });

  it("on warms lazily", async () => {
    const sound = await load({ enabled: false });
    sound.setPrefs({ enabled: true });
    expect(MockContext.instances).toHaveLength(0);
    runAllIdle();
    expect(context().buffers).toHaveLength(25);
    expect(sound.status).toBe("ready");
  });

  it("re-renders the bank only for a new profile", async () => {
    const sound = await ready();
    const ctx = context();
    sound.setPrefs({ profile: "soft" });
    runAllIdle();
    expect(ctx.buffers).toHaveLength(25);
    sound.setPrefs({ profile: "pop" });
    expect(sound.status).toBe("warming");
    runAllIdle();
    expect(ctx.buffers).toHaveLength(50);
    sound.press("key", "KeyA");
    expect(ctx.buffers.slice(25)).toContain(ctx.sources[0]?.buffer);
  });

  it("renders a profile chosen while off once back on", async () => {
    const sound = await ready();
    const ctx = context();
    sound.setPrefs({ enabled: false, profile: "crisp" });
    runAllIdle();
    expect(ctx.buffers).toHaveLength(25);
    sound.setPrefs({ enabled: true });
    runAllIdle();
    expect(ctx.buffers).toHaveLength(50);
  });
});

describe("sound off means no context", () => {
  it("builds nothing when turned off before idle", async () => {
    const sound = await load();
    sound.setPrefs({ enabled: false });
    runAllIdle();
    expect(MockContext.instances).toHaveLength(0);
    sound.setPrefs({ enabled: true });
    runAllIdle();
    expect(MockContext.instances).toHaveLength(1);
    expect(sound.status).toBe("ready");
  });

  it("builds one context through any number of quick toggles", async () => {
    const sound = await load();
    for (let i = 0; i < 20; i++) {
      sound.setPrefs({ enabled: i % 2 === 1 });
      if (i % 5 === 0) runIdle();
    }
    sound.setPrefs({ enabled: true });
    runAllIdle();
    expect(MockContext.instances).toHaveLength(1);
  });

  it("does not rebuild a recreated context once turned off", async () => {
    const sound = await ready();
    const ctx = context();
    sound.press("key", "KeyA");
    advance(10);
    sound.press("key", "KeyB");
    vi.advanceTimersByTime(200);
    sound.press("key", "KeyC");
    await flush();
    vi.advanceTimersByTime(500);
    expect(ctx.closeCalls).toBe(1);
    sound.setPrefs({ enabled: false });
    runAllIdle();
    expect(MockContext.instances).toHaveLength(1);
  });

  it("reports suspended after a preview, not ready", async () => {
    const sound = await ready();
    sound.setPrefs({ enabled: false });
    sound.preview();
    await flush();
    expect(context().state).toBe("running");
    expect(sound.status).toBe("suspended");
  });
});

describe("setPrefs", () => {
  it("leaves a field alone when the partial carries undefined", async () => {
    const sound = await ready({ profile: "pop", volume: 1 });
    const ctx = context();
    const master = ctx.panners[0]?.outputs[0] as MockGain;
    sound.setPrefs({ profile: undefined, enabled: undefined, volume: undefined, spread: undefined });
    runAllIdle();
    expect(master.gain.value).toBe(1);
    expect(sound.status).toBe("ready");
    expect(ctx.buffers).toHaveLength(25);
    sound.press("key", "KeyA");
    expect(started(ctx)).toHaveLength(1);
  });
});

describe("preview", () => {
  it("survives a preference change made while sound is off", async () => {
    const sound = await load({ enabled: false });
    sound.preview("pop");
    runAllIdle();
    const ctx = context();
    sound.preview("crisp");
    sound.setPrefs({ profile: "crisp", volume: 0.3 });
    expect(started(ctx)).toHaveLength(2);
    expect(ctx.sources.every((source) => source.stopped === 0)).toBe(true);
    expect(ctx.suspendCalls).toBe(0);
  });

  it("is dropped by muting while it waits on resume", async () => {
    MockContext.initialState = "suspended";
    MockContext.autoResume = false;
    const sound = await ready();
    const ctx = context();
    sound.preview();
    sound.setPrefs({ enabled: false });
    ctx.setState("running");
    expect(ctx.sources).toHaveLength(0);
  });

  it("is dropped by hiding the page while it waits on resume", async () => {
    MockContext.initialState = "suspended";
    MockContext.autoResume = false;
    const target = Object.assign(new EventTarget(), { hidden: false });
    vi.stubGlobal("document", target);
    const sound = await ready();
    const ctx = context();
    sound.preview();
    target.hidden = true;
    target.dispatchEvent(new Event("visibilitychange"));
    ctx.setState("running");
    expect(ctx.sources).toHaveLength(0);
  });

  it("plays once, immediately, in any profile", async () => {
    const sound = await ready();
    const ctx = context();
    sound.preview("crisp");
    expect(started(ctx)).toHaveLength(1);
    expect(ctx.buffers).toHaveLength(26);
    expect(ctx.sources[0]?.buffer).toBe(ctx.buffers[25]);
  });

  it("warms and plays when nothing has been built, even with sound off", async () => {
    const sound = await load({ enabled: false });
    sound.preview();
    expect(MockContext.instances).toHaveLength(0);
    runAllIdle();
    expect(started(context())).toHaveLength(1);
    expect(sound.status).toBe("suspended");
  });

  it("waits for a suspended context", async () => {
    MockContext.initialState = "suspended";
    MockContext.autoResume = false;
    const sound = await ready();
    const ctx = context();
    sound.preview();
    expect(ctx.resumeCalls).toBe(1);
    expect(ctx.sources).toHaveLength(0);
    ctx.setState("running");
    expect(started(ctx)).toHaveLength(1);
  });
});

describe("never throws", () => {
  it("survives Web Audio throwing on press and release", async () => {
    const sound = await ready();
    const ctx = context();
    sound.press("key", "KeyA");
    ctx.throwOnSource = true;
    advance(10);
    expect(() => sound.press("key", "KeyB")).not.toThrow();
    expect(() => sound.release("KeyA")).not.toThrow();
    expect(() => sound.preview()).not.toThrow();
  });

  it("survives resume and suspend throwing or rejecting", async () => {
    const sound = await ready();
    const ctx = context();
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    ctx.resume = () => {
      throw new Error("closed");
    };
    ctx.suspend = () => Promise.reject(new Error("closed"));
    ctx.state = "suspended";
    expect(() => sound.press("key", "KeyA")).not.toThrow();
    expect(() => sound.unlock()).not.toThrow();
    ctx.state = "running";
    expect(() => sound.sleep()).not.toThrow();
    await flush();
    vi.useRealTimers();
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("survives unknown input", async () => {
    const sound = await ready();
    expect(() => sound.press("key", "")).not.toThrow();
    expect(() => sound.release("")).not.toThrow();
    expect(() => sound.release("Nope")).not.toThrow();
  });
});

describe("teardown under a hostile Web Audio", () => {
  const stopThrows = (ctx: MockContext) => {
    for (const source of ctx.sources) {
      source.stop = () => {
        throw new Error("InvalidStateError");
      };
    }
  };

  it("closes and removes listeners when stopping a voice throws", async () => {
    const win = new EventTarget();
    vi.stubGlobal("window", win);
    const remove = vi.spyOn(win, "removeEventListener");
    const sound = await ready();
    const ctx = context();
    sound.press("key", "KeyA");
    stopThrows(ctx);
    expect(() => sound.dispose()).not.toThrow();
    expect(ctx.closeCalls).toBe(1);
    expect(remove).toHaveBeenCalledWith("blur", expect.any(Function));
  });

  it("still suspends when stopping a voice throws", async () => {
    const sound = await ready();
    const ctx = context();
    sound.press("key", "KeyA");
    stopThrows(ctx);
    expect(() => sound.sleep()).not.toThrow();
    expect(ctx.suspendCalls).toBe(1);
  });

  it("closes the context when a render fails, and stays quiet", async () => {
    const sound = await load();
    runIdle();
    runIdle();
    const ctx = context();
    ctx.createBuffer = (() => {
      throw new Error("out of memory");
    }) as never;
    expect(() => runAllIdle()).not.toThrow();
    expect(sound.status).toBe("failed");
    expect(ctx.closeCalls).toBe(1);
    sound.press("key", "KeyA");
    expect(ctx.sources).toHaveLength(0);
    sound.dispose();
    expect(ctx.closeCalls).toBe(1);
  });

  it("never throws from any call, in any state, with every Web Audio method failing", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const sound = await ready();
    const ctx = context();
    const boom = () => {
      throw new Error("boom");
    };
    for (const method of ["createBufferSource", "createBuffer", "resume", "suspend", "close"] as const) {
      (ctx as unknown as Record<string, unknown>)[method] = boom;
    }
    const everything = () => {
      sound.press("key", "KeyA");
      sound.press("space", "Space", true);
      sound.release("KeyA");
      sound.unlock();
      sound.setPrefs({ volume: 0.3, profile: "pop" });
      sound.setPrefs({ profile: "soft" });
      sound.preview("crisp");
      sound.latency();
      void sound.status;
      sound.sleep();
    };
    for (const state of ["running", "suspended", "interrupted", "closed"] as AudioContextState[]) {
      ctx.state = state;
      expect(everything).not.toThrow();
      expect(() => runAllIdle()).not.toThrow();
      vi.advanceTimersByTime(40_000);
      expect(() => runAllIdle()).not.toThrow();
      await flush();
    }
    expect(() => sound.dispose()).not.toThrow();
    expect(everything).not.toThrow();
    vi.useRealTimers();
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe("the key path", () => {
  it("never constructs a context synchronously, whatever the state", async () => {
    let inKey = false;
    let constructedInKey = 0;
    const Original = MockContext;
    vi.stubGlobal(
      "AudioContext",
      class extends Original {
        constructor() {
          super();
          if (inKey) constructedInKey++;
        }
      },
    );
    const sound = await load();
    for (let i = 0; i < 50; i++) {
      inKey = true;
      sound.unlock();
      sound.press("key", "KeyA");
      sound.release("KeyA");
      inKey = false;
      if (i % 3 === 0) runIdle();
      vi.advanceTimersByTime(700);
      const ctx = MockContext.instances.at(-1);
      if (ctx) ctx.state = "running";
    }
    expect(MockContext.instances.length).toBeGreaterThan(1);
    expect(constructedInKey).toBe(0);
  });

  it("keeps at most 6 voices live through a 20,000 key burst with error and release on", async () => {
    const sound = await ready({ errorSound: true, release: true });
    const ctx = context();
    const live = new Map<MockSource, number>();
    const keys = [
      ["key", "KeyA"],
      ["key", "KeyS"],
      ["space", "Space"],
      ["enter", "Enter"],
      ["backspace", "Backspace"],
    ] as const;
    let seen = 0;
    let most = 0;
    for (let now = 0; now < 20_000; now++) {
      const [cls, code] = keys[now % keys.length] ?? keys[0];
      const [, previous] = keys[(now + 2) % keys.length] ?? keys[0];
      sound.press(cls, code, now % 3 === 0);
      sound.release(previous);
      advance(1);
      for (; seen < ctx.sources.length; seen++) {
        const source = ctx.sources[seen] as MockSource;
        live.set(source, now + ((source.buffer?.duration ?? 0) / source.playbackRate.value) * 1000);
      }
      for (const [source, endsAt] of live) if (source.stopped > 0 || endsAt <= now) live.delete(source);
      most = Math.max(most, live.size);
    }
    expect(most).toBeLessThanOrEqual(6);
    expect(ctx.panners).toHaveLength(6);
  });
});

describe("latency", () => {
  it("reports zeros and null before a context exists", async () => {
    const sound = await load({ enabled: false });
    expect(sound.latency()).toEqual({ baseMs: 0, outputMs: 0, underruns: null });
  });

  it("reports context figures and underruns where stats exist", async () => {
    const sound = await ready();
    const ctx = context();
    expect(sound.latency()).toEqual({ baseMs: 5, outputMs: 20, underruns: null });
    Object.assign(ctx, { playbackStats: { underrunEvents: 3 } });
    expect(sound.latency().underruns).toBe(3);
  });
});

describe("dispose", () => {
  it("closes the context, stops voices and removes listeners", async () => {
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { hidden: true });
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", doc);
    const removeWindow = vi.spyOn(win, "removeEventListener");
    const removeDocument = vi.spyOn(doc, "removeEventListener");
    const sound = await ready();
    const ctx = context();
    sound.press("key", "KeyA");
    sound.dispose();
    expect(ctx.closeCalls).toBe(1);
    expect(ctx.sources[0]?.stopped).toBe(1);
    expect(removeWindow).toHaveBeenCalledWith("blur", expect.any(Function));
    expect(removeDocument).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(ctx.suspendCalls).toBe(0);
  });

  it("is inert afterwards and leaves no timers", async () => {
    const sound = await ready();
    const ctx = context();
    sound.press("key", "KeyA");
    sound.dispose();
    sound.press("key", "KeyB");
    sound.release("KeyA");
    sound.setPrefs({ enabled: true, profile: "pop" });
    sound.preview();
    sound.unlock();
    runAllIdle();
    expect(MockContext.instances).toHaveLength(1);
    expect(ctx.sources).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(sound.status).toBe("suspended");
    expect(() => sound.dispose()).not.toThrow();
  });

  it("does not build when disposed before idle", async () => {
    const sound = await load();
    sound.dispose();
    runAllIdle();
    expect(MockContext.instances).toHaveLength(0);
  });

  it("allows a fresh engine after dispose", async () => {
    (await ready()).dispose();
    const second = await ready();
    second.press("key", "KeyA");
    expect(started(context())).toHaveLength(1);
    expect(MockContext.instances).toHaveLength(2);
  });
});
