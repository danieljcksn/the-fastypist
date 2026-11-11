import { crisp } from "./geometry";
import type { PlacedLabel } from "./labels";

export interface Plot {
  w: number;
  /** Where the rules and the data start: the rule values sit in a gutter to the left of it. */
  left: number;
  /** y of the top rule and of the baseline. */
  top: number;
  base: number;
  /** Baseline of the x labels. */
  xText: number;
  /** One line of label text, and the gap between a label and its rule. */
  lh: number;
  pad: number;
}

/** Space between a rule value and the start of its rule. */
const GUTTER_GAP = 8;

/**
 * The plot inside a frame: rule values in a left gutter as wide as the widest of them, centred on their rules. The line above
 * the top rule stays free for annotations such as the next decade, and the x labels take the last line.
 */
export function plotOf(w: number, h: number, px: number, gutter: number, below = 0): Plot {
  // 20 px lines at 14 px, as the text around the chart.
  const lh = Math.round(px * 1.43);
  const pad = 6;
  const top = lh;
  const xText = h - 4;
  const base = h - lh - 8 - below;
  return { w, left: gutter, top, base, xText, lh, pad };
}

export function gutterOf(ticks: readonly number[], format: (v: number) => string, measure: (t: string) => number): number {
  return Math.max(0, ...ticks.map((v) => measure(format(v)))) + GUTTER_GAP;
}

/** Labels laid out along the plot's own width, then moved past the gutter. */
export function plotLabels(plot: Plot, layout: (width: number, at: (x: number) => number) => PlacedLabel[]): PlacedLabel[] {
  return layout(plot.w - plot.left, (x) => x - plot.left).map((label) => ({ ...label, x: label.x + plot.left, left: label.left + plot.left }));
}

/** Dashed rules from the gutter to the edge and a solid baseline. */
export function YRules({ ticks, y, plot, solidBase = true }: { ticks: readonly number[]; y(v: number): number; plot: Plot; solidBase?: boolean }) {
  const low = ticks[0];
  let grid = "";
  for (const v of ticks) {
    if (solidBase && v === low) continue;
    grid += `M${plot.left} ${crisp(y(v))}H${plot.w}`;
  }
  return (
    <>
      {grid ? <path className="cx-grid" d={grid} /> : null}
      {solidBase && low !== undefined ? <path className="cx-base" d={`M${plot.left} ${crisp(y(low))}H${plot.w}`} /> : null}
    </>
  );
}

/** Rule values right-aligned in the gutter. A baseline 0.35em under the rule centres a figure's cap height on it. */
export function YLabels({ ticks, y, format, plot, px }: { ticks: readonly number[]; y(v: number): number; format(v: number): string; plot: Plot; px: number }) {
  return (
    <>
      {ticks.map((v) => (
        <text key={v} className="cx-y" x={plot.left - GUTTER_GAP} y={Math.round(y(v) + px * 0.35)} textAnchor="end">
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
        <text key={`${label.x}-${label.text}`} x={label.anchor === "start" ? Math.max(plot.left, Math.round(label.left)) : label.anchor === "end" ? Math.min(plot.w, Math.round(label.x)) : Math.round(label.x)} y={plot.xText} textAnchor={label.anchor}>
          {label.text}
        </text>
      ))}
    </>
  );
}
