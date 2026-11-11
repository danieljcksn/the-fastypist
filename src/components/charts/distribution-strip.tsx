"use client";

import { useFrame } from "./frame";
import { crisp } from "./geometry";
import { linear } from "./scale";
import "./charts.css";
import "./small-charts.css";

/** Under five players a spread is a handful of people, and placing someone among them says more than it should. */
export const STRIP_MIN_PLAYERS = 5;

export interface Strip {
  ticks: number[];
  xs: number[];
  /** Each pixel column with players on it, and how strongly it is drawn. */
  columns: { x: number; alpha: number }[];
  mine: number | null;
}

// One player's tick while players average 10 px apart or more. Closer than that, each tick is fainter by the square root of
// the crowding, and players on one pixel add up as layered ticks would, so a dense middle reads darker instead of 300 players
// filling one grey bar.
const TICK_ALPHA = 0.55;
const TICK_SPACING_PX = 10;

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
  // Ends on the fives just outside the field, so the spread fills the strip.
  const from = Math.floor(low / 5) * 5;
  const to = Math.max(from + 5, Math.ceil(high / 5) * 5);
  const ticks = [from, to];
  const x = linear([from, to], [1, w - 1]);
  const xs = values.map((v) => crisp(x(v)));
  const counts = new Map<number, number>();
  for (const at of xs) counts.set(at, (counts.get(at) ?? 0) + 1);
  const one = TICK_ALPHA * Math.min(1, Math.sqrt(w / TICK_SPACING_PX / values.length));
  const columns = [...counts].map(([at, n]) => ({ x: at, alpha: Math.round((1 - (1 - one) ** n) * 100) / 100 }));
  return { ticks, xs, columns, mine: mine === null ? null : Math.floor(x(mine)) + 1 };
}

/** One path per opacity. */
function layers(columns: Strip["columns"], top: number, base: number): Map<number, string> {
  const out = new Map<number, string>();
  for (const c of columns) out.set(c.alpha, `${out.get(c.alpha) ?? ""}M${c.x} ${top}V${base}`);
  return out;
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
            {[...layers(strip.columns, top + 4, base)].map(([alpha, d]) => (
              <path key={alpha} className="cx-strip-tick" style={{ strokeOpacity: alpha }} d={d} />
            ))}
            {strip.mine !== null ? <path className="cx-strip-mine" d={`M${strip.mine} ${top - 2}V${base}`} /> : null}
          </svg>
        </>
      ) : null}
    </div>
  );
}
