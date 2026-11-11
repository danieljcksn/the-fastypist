export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function overlaps(a: Box, b: Box, pad = 0): boolean {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
}

export function inside(a: Box, bounds: Box): boolean {
  return a.x >= bounds.x && a.y >= bounds.y && a.x + a.w <= bounds.x + bounds.w && a.y + a.h <= bounds.y + bounds.h;
}

/** The first candidate that stays inside the bounds and clear of everything taken, or null when none does. */
export function place(candidates: readonly Box[], taken: readonly Box[], bounds: Box, pad = 4): Box | null {
  for (const box of candidates) {
    if (inside(box, bounds) && taken.every((t) => !overlaps(box, t, pad))) return box;
  }
  return null;
}

export interface AxisLabel {
  x: number;
  text: string;
}

export interface PlacedLabel extends AxisLabel {
  /** Where the text sits against its x: the first label starts there, the last ends there, the rest centre on it. */
  anchor: "start" | "middle" | "end";
  left: number;
}

/**
 * Labels along one axis. The first and last pin to the plot's edges; the ones between are kept in order while they clear
 * the last one kept by `gap`, and a label that would crowd the end label gives way to it.
 */
export function axisLabels(labels: readonly AxisLabel[], measure: (text: string) => number, width: number, gap: number, pinEnds = true): PlacedLabel[] {
  const boxes = labels.map((label, i): PlacedLabel => {
    const w = measure(label.text);
    const atStart = pinEnds && i === 0 && label.x <= w / 2;
    const atEnd = pinEnds && i === labels.length - 1 && label.x >= width - w / 2;
    const anchor = atStart || label.x - w / 2 < 0 ? "start" : atEnd || label.x + w / 2 > width ? "end" : "middle";
    const left = anchor === "start" ? Math.max(0, label.x) : anchor === "end" ? Math.min(width, label.x) - w : label.x - w / 2;
    return { ...label, anchor, left };
  });
  const widths = labels.map((label) => measure(label.text));
  const last = boxes.length - 1;
  const kept: number[] = [];
  boxes.forEach((box, i) => {
    const right = (j: number | undefined) => (j === undefined ? -Infinity : (boxes[j]?.left ?? 0) + (widths[j] ?? 0));
    if (box.left < right(kept.at(-1)) + gap) {
      if (i !== last || !pinEnds) return;
      // The end label carries the run's length or the latest date, so it wins over the labels before it.
      while (kept.length > 0 && box.left < right(kept.at(-1)) + gap) kept.pop();
    }
    kept.push(i);
  });
  return kept.map((i) => boxes[i] as PlacedLabel);
}

/**
 * Month labels at one stride: every month, else every second, third and so on, counted back from the latest so it is
 * always labelled. Dropping only the labels that collide would space the rest unevenly.
 */
export function strideLabels(labels: readonly AxisLabel[], measure: (text: string) => number, width: number, gap: number): PlacedLabel[] {
  const last = labels.length - 1;
  for (let k = 1; k <= Math.max(1, last); k = k < 4 ? k + 1 : k < 6 ? 6 : k + 6) {
    const picked = labels.filter((_, i) => (last - i) % k === 0);
    const placed = axisLabels(picked, measure, width, gap, false);
    if (placed.length === picked.length) return placed;
  }
  return axisLabels(labels.slice(-1), measure, width, gap, false);
}
