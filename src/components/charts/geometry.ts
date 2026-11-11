/** A 1 px stroke centred on a whole pixel paints half of two rows. On the half pixel it paints exactly one. */
export function crisp(v: number): number {
  return Math.floor(v) + 0.5;
}

export function snap(v: number): number {
  return Math.round(v);
}

const f = (v: number) => Math.round(v * 100) / 100;

export type Point = readonly [number, number];

export function linePath(points: readonly Point[]): string {
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${f(x)} ${f(y)}`).join("");
}

/**
 * Fritsch and Carlson's monotone cubic: it never overshoots a data point, so a smooth curve can't invent a peak or a dip
 * that isn't in the numbers.
 */
export function curvePath(points: readonly Point[]): string {
  const n = points.length;
  const first = points[0];
  if (!first) return "";
  if (n < 3) return linePath(points);
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = points[i] as Point;
    const b = points[i + 1] as Point;
    dx.push(b[0] - a[0]);
    m.push(b[0] === a[0] ? 0 : (b[1] - a[1]) / (b[0] - a[0]));
  }
  const t: number[] = new Array<number>(n).fill(0);
  t[0] = m[0] ?? 0;
  t[n - 1] = m[n - 2] ?? 0;
  for (let i = 1; i < n - 1; i++) {
    const m0 = m[i - 1] ?? 0;
    const m1 = m[i] ?? 0;
    const d0 = dx[i - 1] ?? 0;
    const d1 = dx[i] ?? 0;
    t[i] = m0 * m1 <= 0 ? 0 : (3 * (d0 + d1)) / ((2 * d1 + d0) / m0 + (d1 + 2 * d0) / m1);
  }
  let d = `M${f(first[0])} ${f(first[1])}`;
  for (let i = 0; i < n - 1; i++) {
    const a = points[i] as Point;
    const b = points[i + 1] as Point;
    const h = (dx[i] ?? 0) / 3;
    d += `C${f(a[0] + h)} ${f(a[1] + (t[i] ?? 0) * h)} ${f(b[0] - h)} ${f(b[1] - (t[i + 1] ?? 0) * h)} ${f(b[0])} ${f(b[1])}`;
  }
  return d;
}

/** Closes a line down to the baseline, for the area under it. */
export function areaPath(line: string, points: readonly Point[], base: number): string {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last || line === "") return "";
  return `${line}L${f(last[0])} ${f(base)}L${f(first[0])} ${f(base)}Z`;
}

/** Splits a series wherever consecutive x values are further apart than `gap`, so a long break draws as one. */
export function splitAt<T>(items: readonly T[], x: (item: T) => number, gap: number): T[][] {
  const out: T[][] = [];
  let current: T[] = [];
  for (const item of items) {
    const prev = current.at(-1);
    if (prev !== undefined && x(item) - x(prev) >= gap) {
      out.push(current);
      current = [];
    }
    current.push(item);
  }
  if (current.length > 0) out.push(current);
  return out;
}

/** Whole-pixel left edges for n cells of whole-pixel width filling exactly `width`: the remainder goes into the gaps, evenly. */
export function cellEdges(n: number, cell: number, width: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [0];
  const spare = width - n * cell;
  return Array.from({ length: n }, (_, i) => i * cell + Math.round((i * spare) / (n - 1)));
}
