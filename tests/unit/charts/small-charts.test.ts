import { describe, expect, it } from "vitest";
import { STRIP_MIN_PLAYERS, stripOf } from "@/components/charts/distribution-strip";
import { sparkPoints } from "@/components/charts/sparkline";

describe("pace sparkline", () => {
  it("draws nothing under two points and fits the rest inside the box", () => {
    expect(sparkPoints([{ t: 0, pace: 70 }], 200, 40)).toEqual([]);
    const points = sparkPoints(
      [
        { t: 0, pace: 60 },
        { t: 5, pace: 80 },
        { t: 10, pace: 70 },
      ],
      200,
      40,
    );
    expect(points.map((p) => p[0])).toEqual([0, 97.5, 195]);
    expect(Math.min(...points.map((p) => p[1]))).toBeGreaterThanOrEqual(4);
    expect(Math.max(...points.map((p) => p[1]))).toBeLessThanOrEqual(36);
  });

  it("puts a flat Pace in the middle, not on the floor", () => {
    const points = sparkPoints(
      [
        { t: 0, pace: 72 },
        { t: 1, pace: 72 },
      ],
      100,
      40,
    );
    expect(points[0]?.[1]).toBe(20);
  });
});

describe("distribution strip", () => {
  it("is never shown below five players", () => {
    expect(stripOf([50, 60, 70, 80], 70, 300)).toBeNull();
    expect(STRIP_MIN_PLAYERS).toBe(5);
  });

  it("lands every player on a pixel inside the strip, and you on yours", () => {
    const strip = stripOf([42.1, 55, 61.3, 78.4, 99.9], 78.4, 301);
    expect(strip?.ticks[0]).toBeLessThanOrEqual(42.1);
    expect(strip?.ticks.at(-1)).toBeGreaterThanOrEqual(99.9);
    expect(strip?.xs.every((x) => x % 1 === 0.5 && x > 0 && x < 301)).toBe(true);
    expect(strip?.mine).toBe((strip?.xs[3] ?? 0) + 0.5);
  });

  it("ends on the fives just outside the field", () => {
    const field = Array.from({ length: 42 }, (_, i) => 3 + i * 2.6);
    expect(stripOf(field, null, 300)?.ticks).toEqual([0, 110]);
  });

  it("fades each tick as the board grows, and darkens pixels where players stack", () => {
    const alpha = (n: number, w: number) => Math.min(...(stripOf(Array.from({ length: n }, (_, i) => 40 + (i * 61) / n), null, w)?.columns.map((c) => c.alpha) ?? []));
    expect(alpha(30, 300)).toBeCloseTo(0.55);
    expect(alpha(300, 300)).toBeLessThan(0.2);
    expect(alpha(300, 900)).toBeGreaterThan(alpha(300, 300));
    const stacked = stripOf([...Array.from({ length: 299 }, (_, i) => 40 + i * 0.2), 70, 70, 70], null, 300);
    const at70 = stacked?.columns.find((c) => c.x === stacked.xs.at(-1));
    expect(at70?.alpha).toBeGreaterThan(Math.min(...(stacked?.columns.map((c) => c.alpha) ?? [])));
  });
});
