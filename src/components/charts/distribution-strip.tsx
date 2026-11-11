"use client";

import { useFrame } from "./frame";
import { crisp } from "./geometry";
import { linear, niceTicks } from "./scale";
import "./charts.css";
import "./small-charts.css";

/** Under five players a spread is a handful of people, and placing someone among them says more than it should. */
export const STRIP_MIN_PLAYERS = 5;

export interface Strip {
  ticks: number[];
  xs: number[];
  mine: number | null;
}

/**
 * Everyone on today's board along one speed axis, on whole pixels so equal speeds stack on one line. Your 2 px mark covers
 * the pixel of your own 1 px tick and the one after it.
 */
export function stripOf(values: readonly number[], mine: number | null, w: number): Strip | null {
  if (values.length < STRIP_MIN_PLAYERS) return null;
  let low = Infinity;
  let high = -Infinity;
  for (const v of values) {
    low = Math.min(low, v);
    high = Math.max(high, v);
  }
  // Ends on round values in fives, as close to the field as that allows, so the spread fills the strip.
  const ticks = niceTicks(low, high, 8, undefined, 5).values;
  const x = linear([ticks[0] ?? 0, ticks.at(-1) ?? 1], [1, w - 1]);
  return { ticks, xs: values.map((v) => crisp(x(v))), mine: mine === null ? null : Math.floor(x(mine)) + 1 };
}

export function DistributionStrip({ values, mine, label, revealKey }: { values: readonly number[]; mine: number | null; label: string; revealKey: string }) {
  const { ref, frame } = useFrame<HTMLDivElement>(revealKey);
  if (values.length < STRIP_MIN_PLAYERS) return null;
  const strip = frame ? stripOf(values, mine, frame.w) : null;
  const h = frame?.h ?? 0;
  const lh = Math.round((frame?.px ?? 14) * 1.43);
  const top = 4;
  const base = h - lh - 6;
  return (
    <div ref={ref} className="cx cx-strip" role="img" aria-label={label}>
      {frame && strip ? (
        <>
          <svg width={frame.w} height={h} aria-hidden="true">
            <path className="cx-base" d={`M0 ${crisp(base)}H${frame.w}`} />
            <text x={0} y={h - 4}>
              {strip.ticks[0]}
            </text>
            <text x={frame.w} y={h - 4} textAnchor="end">
              {strip.ticks.at(-1)}
            </text>
          </svg>
          <svg className="cx-data" width={frame.w} height={h} aria-hidden="true">
            <path className="cx-strip-tick" d={strip.xs.map((x) => `M${x} ${top + 4}V${base}`).join("")} />
            {strip.mine !== null ? <path className="cx-strip-mine" d={`M${strip.mine} ${top - 2}V${base}`} /> : null}
          </svg>
        </>
      ) : null}
    </div>
  );
}
