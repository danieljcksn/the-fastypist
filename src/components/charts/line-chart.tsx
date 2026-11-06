"use client";

import { useId, useState } from "react";

export interface XY {
  x: number;
  y: number;
}

interface LineChartProps {
  /** The chart's name and finding for a screen reader. Every point is also reachable through the readout. */
  label: string;
  line: readonly XY[];
  dots?: readonly XY[];
  /** x values, drawn as ticks on the baseline. */
  ticks?: readonly number[];
  rules: readonly number[];
  formatRule(value: number): string;
  xDomain: readonly [number, number];
  xLabels: readonly { x: number; text: string }[];
  /** A dot and its value, on the point the finding is about. */
  marker?: { x: number; y: number; text: string };
  readout(point: XY): string;
}

// Plot coordinates are 0..100 on both axes and preserveAspectRatio stretches them, so the type and the strokes never do.
const TICK_HEIGHT = 7;

export function LineChart({ label, line, dots = [], ticks = [], rules, formatRule, xDomain, xLabels, marker, readout }: LineChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const describedBy = useId();
  const yLow = rules[0] ?? 0;
  const yHigh = rules.at(-1) ?? 1;
  const [xLow, xHigh] = xDomain;
  const px = (x: number) => (xHigh === xLow ? 0 : ((x - xLow) / (xHigh - xLow)) * 100);
  const py = (y: number) => (yHigh === yLow ? 100 : 100 - ((y - yLow) / (yHigh - yLow)) * 100);
  const round = (n: number) => Math.round(n * 100) / 100;

  const path = line.map((p, i) => `${i === 0 ? "M" : "L"}${round(px(p.x))} ${round(py(p.y))}`).join("");
  // A zero-length segment with a round cap stays a circle however far the plot stretches.
  const dotPath = dots.map((p) => `M${round(px(p.x))} ${round(py(p.y))}h0`).join("");
  const tickPath = ticks.map((x) => `M${round(px(x))} 100V${100 - TICK_HEIGHT}`).join("");

  const targets = line.length > 0 ? line : dots;
  const nearest = (fraction: number): number => {
    let best = 0;
    let gap = Infinity;
    targets.forEach((p, i) => {
      const d = Math.abs(px(p.x) / 100 - fraction);
      if (d < gap) {
        gap = d;
        best = i;
      }
    });
    return best;
  };
  const hovered = hover === null ? null : (targets[hover] ?? null);

  return (
    <div className="ch" role="group" aria-label={label}>
      <div
        className="ch-plot"
        tabIndex={targets.length > 0 ? 0 : undefined}
        aria-describedby={describedBy}
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          setHover(nearest((e.clientX - box.left) / box.width));
        }}
        onPointerLeave={() => setHover(null)}
        onFocus={() => setHover(targets.length - 1)}
        onBlur={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          e.stopPropagation();
          setHover((at) => Math.max(0, Math.min(targets.length - 1, (at ?? targets.length - 1) + (e.key === "ArrowLeft" ? -1 : 1))));
        }}
      >
        {rules.map((value) => (
          <div key={value} className="ch-rule" style={{ top: `${py(value)}%` }}>
            <span>{formatRule(value)}</span>
          </div>
        ))}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {dotPath ? <path className="ch-dots" d={dotPath} /> : null}
          {tickPath ? <path className="ch-ticks" d={tickPath} /> : null}
          {path ? <path className="ch-line" d={path} /> : null}
        </svg>
        {marker ? (
          <div className="ch-marker" data-low={py(marker.y) > 80 || undefined} data-end={px(marker.x) > 92 || undefined} style={{ left: `${px(marker.x)}%`, top: `${py(marker.y)}%` }}>
            <span>{marker.text}</span>
          </div>
        ) : null}
        {hovered ? (
          <div className="ch-cross" data-flip={px(hovered.x) > 60 || undefined} style={{ left: `${px(hovered.x)}%` }}>
            <span>{readout(hovered)}</span>
          </div>
        ) : null}
        <span id={describedBy} className="sr-only" aria-live="off">
          {hovered ? readout(hovered) : ""}
        </span>
      </div>
      <div className="ch-x" aria-hidden="true">
        {xLabels.map(({ x, text }) => {
          const at = px(x);
          return (
            <span key={`${x}-${text}`} data-align={at <= 0 ? "start" : at >= 100 ? "end" : undefined} style={{ left: `${at}%` }}>
              {text}
            </span>
          );
        })}
      </div>
    </div>
  );
}
