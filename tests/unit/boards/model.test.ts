import { describe, expect, it } from "vitest";
import { benchmarks, boardLines, shareText, untilNext } from "@/components/boards/model";
import { paceHistory } from "@/components/boards/pace-history";
import { paceOf, percentileOf } from "@/engine/analysis";
import type { BoardRow } from "@/server/ranking";

const row = (rank: number, wpm: number, name = `t${rank}`): BoardRow => ({ rank, username: name, wpmCx: wpm * 100, accuracyBp: 9_700 });
const shape = (lines: ReturnType<typeof boardLines>) => lines.map((l) => (l.kind === "row" ? l.row.username : `~${l.wpm}`));

describe("reference rows", () => {
  it("come from the same curve as the percentile sentences", () => {
    const [p98, p90, average] = benchmarks();
    expect(average?.wpm).toBe(52);
    expect(percentileOf(p90?.wpm ?? 0)).toBe(90);
    expect(percentileOf(p98?.wpm ?? 0)).toBe(98);
  });

  it("stand alone on an empty board", () => {
    expect(shape(boardLines([], 0))).toEqual(benchmarks().map((b) => `~${b.wpm}`));
  });

  it("sit in value order among real rows, with a real row first on a tie", () => {
    const [p98, p90] = benchmarks().map((b) => b.wpm);
    const rows = [row(1, 120, "fast"), row(2, p90 ?? 0, "tied"), row(3, 40, "slow")];
    expect(shape(boardLines(rows, 3))).toEqual(["fast", `~${p98}`, "tied", `~${p90}`, "~52", "slow"]);
  });

  it("never claim a place below the last row when more rows are on later pages", () => {
    const rows = [row(1, 110), row(2, 70)];
    expect(shape(boardLines(rows, 80))).toEqual(["t1", `~${benchmarks()[0]?.wpm}`, `~${benchmarks()[1]?.wpm}`, "t2"]);
  });
});

describe("new text in", () => {
  it("rounds up to the minute and never reads zero", () => {
    expect(untilNext(4 * 3_600_000 + 11 * 60_000 + 1)).toEqual({ h: 4, m: 12 });
    expect(untilNext(5_000)).toEqual({ h: 0, m: 1 });
    expect(untilNext(0)).toEqual({ h: 0, m: 1 });
  });
});

describe("the daily share", () => {
  const base = { day: "2026-11-11", wpmCx: 8_720, accuracyBp: 9_812, url: "https://example.test/today", lang: "en" as const, ordinal: (n: number) => `${n}th` };

  it("gives the day, speed, accuracy and place, and nothing of the text", () => {
    expect(shareText({ ...base, rank: 3, total: 41 })).toBe("thefastypist, today's text for 2026-11-11: 87 wpm at 98% accuracy, 3th of 41.\nhttps://example.test/today");
  });

  it("leaves the place out under 5 players and off the board", () => {
    expect(shareText({ ...base, rank: 2, total: 4 })).not.toContain(" of ");
    expect(shareText({ ...base, rank: null, total: 41 })).not.toContain(" of ");
  });

  it("speaks Portuguese on the Portuguese site", () => {
    expect(shareText({ ...base, lang: "pt-br", rank: 3, total: 41, ordinal: (n) => `${n}º` })).toContain("87 ppm com 98% de precisão, 3º de 41.");
  });
});

describe("pace history", () => {
  it("starts at the tenth run and matches the ladder's p80 of the last 25", () => {
    const runs = Array.from({ length: 30 }, (_, i) => ({ t: i, wpmCx: 6_000 + ((i * 37) % 11) * 100 }));
    const points = paceHistory(runs);
    expect(points).toHaveLength(21);
    expect(points[0]?.t).toBe(9);
    const last = paceOf(runs.slice(5).map((r) => r.wpmCx)) ?? 0;
    expect(points.at(-1)?.pace).toBe(Math.round(last) / 100);
  });

  it("is empty under ten runs", () => {
    expect(paceHistory(Array.from({ length: 9 }, (_, i) => ({ t: i, wpmCx: 7_000 })))).toEqual([]);
  });
});
