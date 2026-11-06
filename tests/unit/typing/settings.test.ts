import { describe, expect, it } from "vitest";
import { MAX_EXTRA } from "@/engine/core";
import { configFor, RANKED_CONFIG } from "@/engine/presets";
import { keyboardOffset } from "@/typing/keyboard-offset";
import { applyQuery, defaultSettings, isDefault, packIdFor, parseDisplay, parseSettings } from "@/typing/settings";

const base = defaultSettings("en");

describe("presets", () => {
  it("ranks 60 s of time with the capped extras", () => {
    expect(RANKED_CONFIG).toEqual({ mode: "time", durationMs: 60000, stopOn: "none", maxExtra: 4, backspace: "incorrect-only" });
  });

  it("never allows more extras than the engine's ceiling", () => {
    expect(configFor({ kind: "quote" }).maxExtra).toBeLessThanOrEqual(MAX_EXTRA);
  });

  it("gives every text mode words rules", () => {
    for (const mode of [{ kind: "quote" }, { kind: "custom" }, { kind: "words", count: 25 }] as const) {
      expect(configFor(mode)).toMatchObject({ mode: "words", durationMs: 0 });
    }
  });
});

describe("the URL query", () => {
  it("reads every shareable field", () => {
    expect(applyQuery("?mode=time&t=30&lang=pt&tier=5k", base)).toMatchObject({ mode: { kind: "time", seconds: 30 }, language: "pt", tier: "5k" });
    expect(applyQuery("?mode=words&n=50", base).mode).toEqual({ kind: "words", count: 50 });
    expect(applyQuery("?mode=quote", base).mode).toEqual({ kind: "quote" });
  });

  it("falls back on values outside the choices", () => {
    expect(applyQuery("?mode=time&t=9999", base).mode).toEqual({ kind: "time", seconds: 60 });
    expect(applyQuery("?mode=words&n=-1", base).mode).toEqual({ kind: "words", count: 25 });
    expect(applyQuery("?lang=fr&tier=9k", base)).toMatchObject({ language: "en", tier: "1k" });
  });

  it("can't name custom text, which isn't in a link", () => {
    expect(applyQuery("?mode=custom", base).mode).toEqual(base.mode);
  });
});

describe("saved settings", () => {
  it("survives junk", () => {
    for (const junk of [null, 3, "x", [], { mode: { kind: "time", seconds: 7 } }, { language: "de" }, { mode: { kind: "custom" }, customWords: [] }]) {
      const parsed = parseSettings(junk, base);
      expect(parsed.mode).toEqual(base.mode);
      expect(parsed.language).toBe("en");
    }
  });

  it("only keeps custom mode with words to type", () => {
    expect(parseSettings({ mode: { kind: "custom" }, customWords: ["a"] }, base).mode).toEqual({ kind: "custom" });
  });

  it("knows the default per page language", () => {
    expect(isDefault(defaultSettings("pt"), "pt")).toBe(true);
    expect(isDefault(defaultSettings("pt"), "en")).toBe(false);
    expect(isDefault({ ...base, numbers: true }, "en")).toBe(false);
  });

  it("names the frozen packs", () => {
    expect(packIdFor({ language: "pt", tier: "5k" })).toBe("pt-5k@1");
  });

  it("parses display preferences defensively", () => {
    expect(parseDisplay({ caret: "swirl", size: "xxl" })).toMatchObject({ caret: "bar", size: "m" });
    expect(parseDisplay({ caret: "block", size: "xl", liveSpeed: true })).toMatchObject({ caret: "block", size: "xl", liveSpeed: true });
  });
});

describe("keyboard offset", () => {
  it("leaves the test alone when it already clears the keyboard", () => {
    expect(keyboardOffset(200, 300, 0, 400)).toBe(0);
  });

  it("moves it just far enough", () => {
    expect(keyboardOffset(300, 400, 0, 400)).toBe(-12);
  });

  it("never pushes the top out of sight", () => {
    expect(keyboardOffset(100, 500, 0, 200)).toBe(-88);
  });

  it("follows a scrolled visual viewport", () => {
    expect(keyboardOffset(300, 400, 100, 400)).toBe(0);
  });
});
