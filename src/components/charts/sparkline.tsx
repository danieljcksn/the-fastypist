"use client";

import { useFrame } from "./frame";
import { areaPath, linePath, type Point } from "./geometry";
import { linear } from "./scale";
import "./charts.css";
import "./small-charts.css";

// The ring at the end is 4.5 px plus its stroke, and a line on the very top or bottom row would lose half its width.
const INSET = 4;

/** Pace over time as a line with no axes, for a public profile. The range is fitted, since only the shape is read here. */
export function sparkPoints(values: readonly { t: number; pace: number }[], w: number, h: number): Point[] {
  if (values.length < 2) return [];
  const first = values[0]?.t ?? 0;
  const last = values.at(-1)?.t ?? first;
  let low = Infinity;
  let high = -Infinity;
  for (const v of values) {
    low = Math.min(low, v.pace);
    high = Math.max(high, v.pace);
  }
  // A flat Pace sits in the middle rather than on the floor, so it reads as level and not as zero.
  if (high - low < 1) {
    low -= 1;
    high += 1;
  }
  // The end ring is drawn whole, inside the box, so the line stops short of the right edge by its radius and stroke.
  const x = linear([first, last], [0, w - INSET - 1]);
  const y = linear([low, high], [h - INSET, INSET]);
  return values.map((v) => [Math.round(x(v.t) * 10) / 10, Math.round(y(v.pace) * 10) / 10]);
}

export function PaceSparkline({ values, label, revealKey }: { values: readonly { t: number; pace: number }[]; label: string; revealKey: string }) {
  const { ref, frame } = useFrame<HTMLDivElement>(revealKey);
  if (values.length < 2) return null;
  const points = frame ? sparkPoints(values, frame.w, frame.h) : [];
  const line = linePath(points);
  const end = points.at(-1);
  const id = `cx${revealKey.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <div ref={ref} className="cx cx-spark" role="img" aria-label={label}>
      {frame && end ? (
        <svg className="cx-data" width={frame.w} height={frame.h} aria-hidden="true">
          <defs>
            <linearGradient id={id} x1="0" x2="0" y1="0" y2={frame.h} gradientUnits="userSpaceOnUse">
              <stop className="cx-stop" offset="0" style={{ stopOpacity: "var(--cx-area)" }} />
              <stop className="cx-stop" offset="1" style={{ stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          <path d={areaPath(line, points, frame.h)} fill={`url(#${id})`} />
          <path className="cx-line cx-thin" d={line} />
          <circle className="cx-ring" cx={end[0]} cy={end[1]} r={3.5} />
        </svg>
      ) : null}
    </div>
  );
}
