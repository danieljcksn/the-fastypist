import { describe, expect, it } from "vitest";
import { bestRows, calendarOf, CALENDAR_WEEKS, dayTier, languagesOf, recentAccuracy, timeTypedMs, weeklyAccuracy } from "@/components/progress/model";
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

describe("weekly accuracy", () => {
  it("groups free runs by the Sunday their week starts on, with median and quartiles", () => {
    const weeks = weeklyAccuracy([
      row({ localDay: "2026-11-02", accuracyBp: 9600 }),
      row({ localDay: "2026-11-03", accuracyBp: 9700 }),
      row({ localDay: "2026-11-07", accuracyBp: 9800 }),
      row({ localDay: "2026-11-08", accuracyBp: 9000 }),
      row({ localDay: "2026-11-08", accuracyBp: 9900, kind: "drill" }),
    ]);
    expect(weeks.map((w) => w.week)).toEqual(["2026-11-01", "2026-11-08"]);
    expect(weeks[0]).toMatchObject({ runs: 3, median: 97, q1: 96.5, q3: 97.5 });
    expect(weeks[1]).toMatchObject({ runs: 1, median: 90, q1: 90, q3: 90 });
  });

  it("is empty without free runs", () => {
    expect(weeklyAccuracy([row({ kind: "drill" })])).toEqual([]);
  });

  it("groups a long history several weeks to a point, never more than asked", () => {
    const days = Array.from({ length: 300 }, (_, i) => new Date(Date.UTC(2026, 0, 4) + i * 86_400_000).toISOString().slice(0, 10));
    const weeks = weeklyAccuracy(days.map((localDay) => row({ localDay })));
    expect(weeks.length).toBeLessThanOrEqual(16);
    expect(weeks[0]?.span).toBe(3);
    expect(weeks[1]?.n).toBe((weeks[0]?.n ?? 0) + 21);
    expect(weeks.reduce((sum, w) => sum + w.runs, 0)).toBe(300);
  });
});

describe("calendar time", () => {
  it("adds up the time at the keyboard per day", () => {
    const { cells } = calendarOf([row({ localDay: "2026-11-06", elapsedMs: 60_000, afkMs: 5_000 }), row({ localDay: "2026-11-06", elapsedMs: 30_000 })], "2026-11-06");
    expect(cells.at(-1)?.ms).toBe(85_000);
    expect(cells.at(-2)?.ms).toBe(0);
  });
});
