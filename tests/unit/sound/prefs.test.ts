import { afterEach, describe, expect, it, vi } from "vitest";
import { loadSoundPrefs, parseSoundPrefs, saveSoundPrefs } from "@/sound/prefs";
import { DEFAULT_SOUND_PREFS } from "@/sound/types";

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    items,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("defaults", () => {
  it("are off, half volume, soft, no error sound, release and spread on", () => {
    expect(DEFAULT_SOUND_PREFS).toEqual({
      enabled: false,
      volume: 0.5,
      profile: "soft",
      errorSound: false,
      release: true,
      spread: true,
    });
  });
});

describe("parseSoundPrefs", () => {
  it.each([[null], [undefined], [3], ["soft"], [true], [[]], [[1, 2]]])("falls back on %j", (garbage) => {
    expect(parseSoundPrefs(garbage)).toEqual(DEFAULT_SOUND_PREFS);
  });

  it("keeps a valid object", () => {
    const prefs = { enabled: true, volume: 0.2, profile: "pop", errorSound: true, release: false, spread: false };
    expect(parseSoundPrefs(prefs)).toEqual(prefs);
  });

  it("clamps volume to bounds", () => {
    expect(parseSoundPrefs({ volume: -3 }).volume).toBe(0);
    expect(parseSoundPrefs({ volume: 9 }).volume).toBe(1);
    expect(parseSoundPrefs({ volume: 0 }).volume).toBe(0);
  });

  it.each([[Number.NaN], [Number.POSITIVE_INFINITY], ["0.5"], [null], [{}]])("rejects volume %j", (volume) => {
    expect(parseSoundPrefs({ volume }).volume).toBe(DEFAULT_SOUND_PREFS.volume);
  });

  it("replaces bad fields one at a time", () => {
    expect(parseSoundPrefs({ enabled: "yes", profile: "funbox", release: 0, spread: false, errorSound: null })).toEqual({
      ...DEFAULT_SOUND_PREFS,
      spread: false,
    });
  });

  it("does not read a profile from the prototype", () => {
    expect(parseSoundPrefs(JSON.parse('{"__proto__":{"profile":"crisp"}}')).profile).toBe("soft");
  });
});

describe("storage", () => {
  it("round-trips", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    saveSoundPrefs({ ...DEFAULT_SOUND_PREFS, enabled: true, profile: "crisp" });
    expect(loadSoundPrefs()).toEqual({ ...DEFAULT_SOUND_PREFS, enabled: true, profile: "crisp" });
  });

  it("validates before writing", () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    saveSoundPrefs({ ...DEFAULT_SOUND_PREFS, volume: 40 });
    expect(JSON.parse([...storage.items.values()][0] ?? "null").volume).toBe(1);
  });

  it("returns defaults for corrupt JSON", () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    saveSoundPrefs(DEFAULT_SOUND_PREFS);
    const key = [...storage.items.keys()][0] ?? "";
    storage.items.set(key, "{not json");
    expect(loadSoundPrefs()).toEqual(DEFAULT_SOUND_PREFS);
  });

  it("returns a copy, not the shared defaults", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    expect(loadSoundPrefs()).not.toBe(DEFAULT_SOUND_PREFS);
  });

  it("survives methods that throw", () => {
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("quota");
      },
    });
    expect(loadSoundPrefs()).toEqual(DEFAULT_SOUND_PREFS);
    expect(() => saveSoundPrefs(DEFAULT_SOUND_PREFS)).not.toThrow();
  });

  it("survives the accessor itself throwing", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("denied", "SecurityError");
      },
    });
    expect(loadSoundPrefs()).toEqual(DEFAULT_SOUND_PREFS);
    expect(() => saveSoundPrefs(DEFAULT_SOUND_PREFS)).not.toThrow();
  });

  it("survives having no localStorage at all", () => {
    expect(loadSoundPrefs()).toEqual(DEFAULT_SOUND_PREFS);
    expect(() => saveSoundPrefs(DEFAULT_SOUND_PREFS)).not.toThrow();
  });

  it("has no dependency on the engine", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("../../../src/sound/prefs.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/engine|synth/);
  });
});
