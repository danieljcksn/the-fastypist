import { describe, expect, it } from "vitest";
import { bestRows, calendarOf, CALENDAR_WEEKS, dayTier, languagesOf, recentAccuracy, timeTypedMs } from "@/components/progress/model";
import { rulesFor } from "@/components/charts/scale";
import type { HistoryRow } from "@/typing/history/rows";

const row = (over: Partial<HistoryRow> = {}): HistoryRow => ({
  id: "a",
  kind: "free",
  status: "unverified",
  mode: "time",
  amount: 60,
  language: "en",
  pack: "en-1k@1",
  mods: "",
  wpmCx: 8000,
  rawCx: 8200,
  accuracyBp: 9700,
  consistencyBp: null,
  elapsedMs: 60000,
  afkMs: 0,
  finishedAt: 1,
  localDay: "2026-11-06",
  device: "keyboard",
  ...over,
});

describe("calendar", () => {
  it("steps through its tiers", () => {
    expect([0, 1, 2, 3, 4, 7, 8, 50].map(dayTier)).toEqual([0, 1, 2, 2, 3, 3, 4, 4]);
  });

  it("starts on a Sunday and ends on today", () => {
    const { cells } = calendarOf([], "2026-11-06");
    expect(new Date(`${cells[0]?.day}T00:00:00Z`).getUTCDay()).toBe(0);
    expect(cells.at(-1)?.day).toBe("2026-11-06");
    expect(Math.ceil(cells.length / 7)).toBe(CALENDAR_WEEKS);
  });

  it("lands every cell across a daylight saving change, one per day", () => {
    const { cells } = calendarOf([], "2026-11-06");
    expect(new Set(cells.map((c) => c.day)).size).toBe(cells.length);
    expect(cells.map((c) => c.day)).toContain("2026-03-08");
  });

  it("counts days, not runs, and only inside the windows", () => {
    const { daysInYear, daysInMonth, cells } = calendarOf(
      [row({ localDay: "2026-11-06" }), row({ localDay: "2026-11-06" }), row({ localDay: "2026-10-20" }), row({ localDay: "2026-01-01" }), row({ localDay: "2020-01-01" })],
      "2026-11-06",
    );
    expect(daysInYear).toBe(3);
    expect(daysInMonth).toBe(2);
    expect(cells.at(-1)?.runs).toBe(2);
  });

  it("marks where months begin", () => {
    const { months } = calendarOf([], "2026-11-06");
    expect(months.length).toBeGreaterThanOrEqual(11);
    expect(months.every((m, i) => i === 0 || m.column > (months[i - 1]?.column ?? 0))).toBe(true);
  });
});

describe("personal best rows", () => {
  const best = { id: "x", wpmCx: 8000, accuracyBp: 9700, finishedAt: 1 };

  it("orders time, then words, then quotes, plain list first, in this language", () => {
    const rows = bestRows(
      {
        "quote:0|en||": best,
        "words:25|en|en-1k@1|": best,
        "time:60|en|en-5k@1|": best,
        "time:60|en|en-1k@1|p": best,
        "time:60|en|en-1k@1|": best,
        "time:15|en|en-1k@1|": best,
        "time:60|pt|pt-1k@1|": best,
        nonsense: best,
      },
      "en",
    );
    expect(rows.map((r) => r.key)).toEqual(["time:15|en|en-1k@1|", "time:60|en|en-1k@1|", "time:60|en|en-1k@1|p", "time:60|en|en-5k@1|", "words:25|en|en-1k@1|", "quote:0|en||"]);
    expect(rows[3]?.tier).toBe("5k");
    expect(rows.at(-1)?.tier).toBeNull();
  });
});

describe("stats", () => {
  it("counts time at the keyboard, never below zero", () => {
    expect(timeTypedMs([row({ elapsedMs: 60000, afkMs: 10000 }), row({ elapsedMs: 1000, afkMs: 5000 })])).toBe(50000);
  });

  it("averages accuracy over recent tests, leaving drills out", () => {
    expect(recentAccuracy([row({ accuracyBp: 9000 }), row({ accuracyBp: 10000 }), row({ kind: "drill", accuracyBp: 0 })])).toBe(95);
    expect(recentAccuracy([row({ kind: "drill" })])).toBeNull();
    expect(recentAccuracy(Array.from({ length: 30 }, (_, i) => row({ accuracyBp: i < 5 ? 0 : 9000 })))).toBe(90);
  });

  it("lists the languages present", () => {
    expect(languagesOf([row(), row({ language: "pt" })])).toEqual(["en", "pt"]);
    expect(languagesOf([])).toEqual([]);
  });
});

describe("chart rules", () => {
  it("covers the data with round values", () => {
    expect(rulesFor(91, 128)).toEqual([80, 100, 120, 140]);
    expect(rulesFor(96.2, 98.4)).toEqual([96, 97, 98, 99]);
  });

  it("honours a fixed step", () => {
    expect(rulesFor(62, 81, 99, 10)).toEqual([60, 70, 80, 90]);
  });

  it("gives a flat line two rules", () => {
    expect(rulesFor(70, 70, 3, 10)).toEqual([70, 80]);
    expect(rulesFor(70, 70)).toEqual([70, 71]);
  });

  it("survives having no data at all", () => {
    expect(rulesFor(Math.min(), Math.max())).toEqual([0, 1]);
  });

  it("copes with zero", () => {
    expect(rulesFor(0, 0)).toEqual([0, 1]);
  });
});
