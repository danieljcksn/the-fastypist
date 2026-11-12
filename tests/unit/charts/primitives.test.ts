import { describe, expect, it } from "vitest";
import { accuracySpan, accuracyTicks, bucketMid } from "@/components/charts/accuracy-chart";
import { calendarGeometry, monthsOf } from "@/components/charts/calendar-chart";
import { cellEdges, crisp, curvePath, splitAt } from "@/components/charts/geometry";
import { axisLabels, overlaps, place, strideLabels } from "@/components/charts/labels";
import { paceModel } from "@/components/charts/pace-chart";
import { linear, nearest, niceTicks, quantile } from "@/components/charts/scale";

const DAY = 86_400_000;
const width = (text: string) => text.length * 8;

describe("niceTicks", () => {
  it("covers the data with round values and at most the intervals asked for", () => {
    expect(niceTicks(0, 87, 4)).toEqual({ values: [0, 25, 50, 75, 100], step: 25 });
    expect(niceTicks(91, 128, 4).values).toEqual([90, 100, 110, 120, 130]);
    expect(niceTicks(62, 81, 99, 10).values).toEqual([60, 70, 80, 90]);
  });

  it("gives a flat line two rules, and no data a scale anyway", () => {
    expect(niceTicks(70, 70, 3, 10).values).toEqual([70, 80]);
    expect(niceTicks(Math.min(), Math.max()).values).toEqual([0, 1]);
    expect(niceTicks(0, 0).values.length).toBe(2);
  });

  it("does not add a rule for floating point dust on a round value", () => {
    expect(niceTicks(0, 100.00000000001, 4).values.at(-1)).toBe(100);
  });
});

describe("scales and lookups", () => {
  it("maps linearly, and a one-value domain to the start", () => {
    expect(linear([0, 10], [0, 200])(2.5)).toBe(50);
    expect(linear([5, 5], [10, 20])(99)).toBe(10);
  });

  it("finds the nearest x, preferring the left on a tie", () => {
    expect(nearest([0, 10, 20], 14)).toBe(1);
    expect(nearest([0, 10, 20], 15)).toBe(1);
    expect(nearest([0, 10, 20], 99)).toBe(2);
    expect(nearest([], 3)).toBe(-1);
  });

  it("interpolates quantiles", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([7], 0.9)).toBe(7);
    expect(quantile([], 0.5)).toBe(0);
  });
});

describe("pixels", () => {
  it("centres a 1 px line on a pixel", () => {
    expect(crisp(10)).toBe(10.5);
    expect(crisp(10.7)).toBe(10.5);
  });

  it("fills a width exactly with whole-pixel cells, spreading the spare pixels over the gaps", () => {
    const edges = cellEdges(53, 11, 720);
    expect(edges[0]).toBe(0);
    expect((edges.at(-1) ?? 0) + 11).toBe(720);
    const gaps = edges.slice(1).map((e, i) => e - (edges[i] ?? 0) - 11);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
    expect(edges.every(Number.isInteger)).toBe(true);
  });

  it("totals the calendar by month for its table", () => {
    const cells = ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"].map((day, i) => ({ day, runs: [2, 0, 1, 3][i] ?? 0, ms: 0, tier: 0 as const }));
    expect(monthsOf({ cells, months: [], daysInYear: 3, daysInMonth: 3 })).toEqual([
      { day: "2026-10-30", days: 1, runs: 2 },
      { day: "2026-11-01", days: 2, runs: 4 },
    ]);
  });

  it("sizes the calendar the way its CSS does", () => {
    for (const w of [350, 527, 528, 720, 900]) {
      const weeks = w < 528 ? 26 : 53;
      const { cell, height } = calendarGeometry(w, weeks);
      expect(cell).toBe(Math.floor((w - (weeks - 1) * 2) / weeks));
      expect(height).toBe(7 * cell + 12);
    }
  });
});

describe("curves", () => {
  it("never overshoots the points it passes through", () => {
    const points = [
      [0, 50],
      [10, 10],
      [20, 12],
      [30, 90],
      [40, 88],
    ] as const;
    const numbers = curvePath(points)
      .replace(/[MC]/g, " ")
      .trim()
      .split(/\s+/)
      .map(Number);
    const ys = numbers.filter((_, i) => i % 2 === 1);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(10);
    expect(Math.max(...ys)).toBeLessThanOrEqual(90);
  });

  it("breaks a series at long gaps", () => {
    expect(splitAt([0, 1, 2, 20, 21], (v) => v, 14)).toEqual([[0, 1, 2], [20, 21]]);
    expect(splitAt([], (v: number) => v, 14)).toEqual([]);
  });
});

describe("labels", () => {
  it("pins the ends to the edges and drops what would collide", () => {
    const placed = axisLabels(
      [
        { x: 0, text: "0" },
        { x: 50, text: "10" },
        { x: 60, text: "12" },
        { x: 400, text: "60 s" },
      ],
      width,
      400,
      16,
    );
    expect(placed.map((p) => p.text)).toEqual(["0", "10", "60 s"]);
    expect(placed[0]?.left).toBe(0);
    expect((placed.at(-1)?.left ?? 0) + width("60 s")).toBe(400);
    for (let i = 1; i < placed.length; i++) {
      const a = placed[i - 1];
      const b = placed[i];
      if (!a || !b) continue;
      expect(overlaps({ x: a.left, y: 0, w: width(a.text), h: 10 }, { x: b.left, y: 0, w: width(b.text), h: 10 }, 16)).toBe(false);
    }
  });

  it("lets the end label win over the one before it", () => {
    const placed = axisLabels(
      [
        { x: 0, text: "0" },
        { x: 380, text: "50" },
        { x: 400, text: "53 s" },
      ],
      width,
      400,
      16,
    );
    expect(placed.map((p) => p.text)).toEqual(["0", "53 s"]);
  });

  it("keeps labels inside the plot when they aren't pinned", () => {
    const placed = axisLabels([{ x: 398, text: "nov" }], width, 400, 16, false);
    expect((placed[0]?.left ?? 0) + width("nov")).toBeLessThanOrEqual(400);
  });

  it("spaces month labels at one stride, counted back from the latest", () => {
    const months = Array.from({ length: 12 }, (_, i) => ({ x: i * 30, text: `m${i}` }));
    const placed = strideLabels(months, width, 360, 16);
    const xs = placed.map((p) => p.x);
    expect(placed.at(-1)?.text).toBe("m11");
    expect(new Set(xs.slice(1).map((x, i) => x - (xs[i] ?? 0))).size).toBe(1);
    expect(strideLabels(months.slice(0, 3).map((m) => ({ ...m, x: m.x * 3 })), width, 360, 16)).toHaveLength(3);
  });

  it("places a label at the first free spot, or nowhere", () => {
    const bounds = { x: 0, y: 0, w: 100, h: 100 };
    const taken = [{ x: 0, y: 0, w: 50, h: 20 }];
    const below = { x: 10, y: 50, w: 20, h: 10 };
    expect(place([{ x: 10, y: 5, w: 20, h: 10 }, below], taken, bounds)).toEqual(below);
    expect(place([{ x: 90, y: 5, w: 20, h: 10 }], taken, bounds)).toBeNull();
  });
});

describe("pace model", () => {
  const runs = (n: number, days: number, wpm: (i: number) => number) => Array.from({ length: n }, (_, i) => ({ t: 1_700_000_000_000 + (i / Math.max(1, n - 1)) * days * DAY, wpmCx: Math.round(wpm(i) * 100) }));

  it("spaces runs evenly under two weeks, and leaves room to reach 10", () => {
    const model = paceModel(runs(3, 2, () => 70), 1_700_000_000_000 + 2 * DAY);
    expect(model.byDate).toBe(false);
    expect(model.domain).toEqual([-0.5, 9.5]);
    expect(model.series).toEqual([]);
  });

  it("goes by date from two weeks, out to today", () => {
    const now = 1_700_000_000_000 + 40 * DAY;
    const model = paceModel(runs(30, 30, () => 70), now);
    expect(model.byDate).toBe(true);
    expect(model.domain[1]).toBe(now);
    expect(model.series[0]?.i).toBe(9);
  });

  it("draws one point a day on a date axis, at that day's last run", () => {
    const day = (t: number) => Math.floor(t / DAY);
    const base = 1_700_000_000_000;
    const many = Array.from({ length: 40 }, (_, i) => ({ t: base + Math.floor(i / 2) * DAY + (i % 2) * 3_600_000, wpmCx: 7000 + (i % 3) * 400 }));
    const model = paceModel(many, base + 20 * DAY, day);
    expect(model.byDate).toBe(true);
    expect(model.series.every((q) => q.i % 2 === 1)).toBe(true);
    expect(new Set(model.series.map((q) => day(many[q.i]?.t ?? 0))).size).toBe(model.series.length);
  });

  it("fits the range past one wild run, and keeps the next decade in it", () => {
    const model = paceModel(runs(200, 90, (i) => (i === 120 ? 171 : i === 90 ? 9 : 72 + (i % 5))), 1_700_000_000_000 + 90 * DAY);
    expect(model.high).toBeLessThan(100);
    expect(model.low).toBeGreaterThan(50);
    expect(model.high).toBeGreaterThanOrEqual(80);
  });
});

describe("accuracy range", () => {
  it("fits whole percents at least five apart and never past 100", () => {
    expect(accuracyTicks(96.4, 97.8)).toEqual([94, 96, 98, 100]);
    expect(accuracyTicks(99.6, 100)).toEqual([94, 96, 98, 100]);
    expect(accuracyTicks(93.2, 98.7)).toEqual([92, 94, 96, 98, 100]);
    expect(accuracyTicks(80.2, 99.1).at(-1)).toBeLessThanOrEqual(100);
    expect(accuracyTicks(90, 100).every(Number.isInteger)).toBe(true);
  });

  it("puts a flat line in the middle, not on the floor", () => {
    const ticks = accuracyTicks(97, 97);
    expect(((ticks[0] ?? 0) + (ticks.at(-1) ?? 0)) / 2).toBe(97);
  });

  it("says where most values sit, or nothing without values", () => {
    expect(accuracySpan([96, 96.4, 97, 97.2, 97.9])).toEqual({ low: 96, high: 98, digits: 0 });
    expect(accuracySpan([])).toBeNull();
  });

  it("places a bucket at the middle of the part of it inside the time range", () => {
    const wk = { week: "2026-11-01", n: 0, span: 3, runs: 4, median: 97, q1: 96, q3: 98, low: 95, high: 99 };
    const start = new Date("2026-11-01T00:00:00").getTime();
    expect(bucketMid(wk, [start - 30 * DAY, start + 60 * DAY])).toBe(start + 10.5 * DAY);
    // The latest bucket is cut at today, and the first at the first run.
    expect(bucketMid(wk, [start - 30 * DAY, start + 4 * DAY])).toBe(start + 2 * DAY);
    expect(bucketMid(wk, [start + 2 * DAY, start + 60 * DAY])).toBe(start + 11.5 * DAY);
  });

  it("keeps a decimal when both ends round to one percent", () => {
    // Medians of 96.5 to 96.8 sit nearer the 96 rule than the 98: "97%" would claim more than the line shows.
    expect(accuracySpan([96.5, 96.6, 96.6, 96.7, 96.8])).toEqual({ low: 96.5, high: 96.8, digits: 1 });
    expect(accuracySpan([97, 97, 97])).toEqual({ low: 97, high: 97, digits: 1 });
  });
});
