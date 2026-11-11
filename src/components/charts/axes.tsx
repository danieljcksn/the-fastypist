import { crisp } from "./geometry";
import type { Box, PlacedLabel } from "./labels";

export interface Plot {
  w: number;
  /** y of the top rule and of the baseline. */
  top: number;
  base: number;
  /** Baseline of the x labels. */
  xText: number;
  /** One line of label text, and the gap between a label and its rule. */
  lh: number;
  pad: number;
}

/** The label of the top rule sits above it, so the plot starts one line down. The x labels take the last line. */
export function plotOf(w: number, h: number, px: number, below = 0): Plot {
  // 20 px lines at 14 px, as the text around the chart.
  const lh = Math.round(px * 1.43);
  const pad = 6;
  const top = lh;
  const xText = h - 4;
  const base = h - lh - 8 - below;
  return { w, top, base, xText, lh, pad };
}

export function rulesTaken(ticks: readonly number[], y: (v: number) => number, format: (v: number) => string, measure: (t: string) => number, plot: Plot): Box[] {
  return ticks.map((v) => ({ x: 0, y: y(v) - plot.lh - 2, w: measure(format(v)) + 4, h: plot.lh }));
}

/** Dashed rules edge to edge with their values above them on the left, and a solid baseline. */
export function YRules({ ticks, y, format, plot, solidBase = true }: { ticks: readonly number[]; y(v: number): number; format(v: number): string; plot: Plot; solidBase?: boolean }) {
  const low = ticks[0];
  let grid = "";
  for (const v of ticks) {
    if (solidBase && v === low) continue;
    grid += `M0 ${crisp(y(v))}H${plot.w}`;
  }
  return (
    <>
      {grid ? <path className="cx-grid" d={grid} /> : null}
      {solidBase && low !== undefined ? <path className="cx-base" d={`M0 ${crisp(y(low))}H${plot.w}`} /> : null}
      {ticks.map((v) => (
        <text key={v} className="cx-y" x={0} y={Math.round(y(v)) - plot.pad}>
          {format(v)}
        </text>
      ))}
    </>
  );
}

export function XLabels({ labels, plot }: { labels: readonly PlacedLabel[]; plot: Plot }) {
  return (
    <>
      {labels.map((label) => (
        // Anchored in SVG as well, so an edge label meets the edge exactly even if a measurement is a pixel off.
        <text key={`${label.x}-${label.text}`} x={label.anchor === "start" ? Math.round(label.left) : label.anchor === "end" ? Math.min(plot.w, Math.round(label.x)) : Math.round(label.x)} y={plot.xText} textAnchor={label.anchor}>
          {label.text}
        </text>
      ))}
    </>
  );
}
