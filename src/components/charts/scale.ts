const STEPS: readonly number[] = [0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500];

export interface Ticks {
  values: number[];
  step: number;
}

/**
 * Round values covering min..max with the smallest step from the list, no finer than `minStep`, that needs at most `most`
 * intervals, or the given step. A flat line still gets a second rule, so it has a scale at all.
 */
export function niceTicks(min: number, max: number, most = 4, fixedStep?: number, minStep = 0): Ticks {
  // Math.min of nothing is Infinity, and the loop below would then push until the array itself gives out.
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { values: [0, 1], step: 1 };
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  let step = fixedStep ?? STEPS.at(-1) ?? 1;
  if (fixedStep === undefined) {
    for (const candidate of STEPS) {
      if (candidate < minStep) continue;
      if (Math.ceil(high / candidate - 1e-9) - Math.floor(low / candidate + 1e-9) <= most) {
        step = candidate;
        break;
      }
    }
  }
  const from = Math.floor(low / step + 1e-9);
  let to = Math.ceil(high / step - 1e-9);
  if (to === from) to = from + 1;
  const values: number[] = [];
  for (let i = from; i <= to; i++) values.push(Math.round(i * step * 1000) / 1000);
  return { values, step };
}

/** A linear map from a domain to a pixel range. A domain of one value maps to the start of the range. */
export function linear(domain: readonly [number, number], range: readonly [number, number]): (v: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  if (d1 === d0) return () => r0;
  const k = (r1 - r0) / (d1 - d0);
  return (v) => r0 + (v - d0) * k;
}

/** Index of the value in a sorted list nearest to x. */
export function nearest(sorted: readonly number[], x: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  if (hi < 0) return -1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] ?? 0) < x) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs((sorted[lo - 1] ?? 0) - x) <= Math.abs((sorted[lo] ?? 0) - x)) return lo - 1;
  return lo;
}

/** The q-quantile of sorted values, interpolated. */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const at = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(at);
  const a = sorted[lo] ?? 0;
  const b = sorted[Math.min(sorted.length - 1, lo + 1)] ?? a;
  return a + (b - a) * (at - lo);
}
