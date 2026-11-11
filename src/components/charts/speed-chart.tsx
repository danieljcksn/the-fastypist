"use client";

import { useMemo } from "react";
import { movingAverage } from "@/engine/analysis";
import type { ReportStrings } from "@/i18n/report";
import { gutterOf, plotLabels, plotOf, XLabels, YLabels, YRules } from "./axes";
import { ChartHead, ChartTable, type Frame, Hit, Readout, useFrame, useScrub } from "./frame";
import { areaPath, crisp, curvePath, linePath, type Point } from "./geometry";
import { type AxisLabel, axisLabels, type Box, place } from "./labels";
import { linear, niceTicks } from "./scale";
import "./charts.css";

/** Under this a 5 s average is most of the run, so each second is drawn as it was. */
export const SPEED_SMOOTH_MIN_S = 20;
const TICK_STEPS = [1, 2, 5, 10, 15, 20, 30, 60, 120, 300, 600] as const;
const MISS_TICK = 6;
const NARROW_PX = 560;
// The smallest change speedFinding will call a change.
const LOW_MIN_SPREAD = 6;

export interface SpeedData {
  /** Net wpm within each second, the last one possibly shorter. */
  speeds: readonly number[];
  /** Mistakes within each second. */
  errors: readonly number[];
  /** ms from the first key, one per mistake. */
  mistakesMs: readonly number[];
  elapsedMs: number;
  finding: string | null;
}

/** Whether the line is clear of a box: every point of it under the box's span passes above or below by `gap`. */
function clearOfLine(box: Box, points: readonly Point[], gap: number): boolean {
  let above = true;
  let below = true;
  for (const [x, y] of points) {
    if (x < box.x - gap || x > box.x + box.w + gap) continue;
    if (y > box.y - gap) above = false;
    if (y < box.y + box.h + gap) below = false;
  }
  return above || below;
}

function Plot({ data, frame, s, revealKey, label }: { data: SpeedData; frame: Frame; s: ReportStrings; revealKey: string; label: string }) {
  const { w, h, measure } = frame;
  const n = data.speeds.length;
  const seconds = data.elapsedMs / 1000;
  const smooth = n >= SPEED_SMOOTH_MIN_S;
  const shown = useMemo(() => (smooth ? movingAverage(data.speeds) : [...data.speeds]), [data.speeds, smooth]);
  // On a phone the plot is short, and five rules crowd it.
  const ticks = niceTicks(0, Math.max(10, ...shown), w < NARROW_PX ? 2 : 4, undefined, 1).values;
  const format = (v: number) => String(v);
  const plot = plotOf(w, h, frame.px, gutterOf(ticks, format, measure), MISS_TICK + 4);
  const top = ticks.at(-1) ?? 10;
  const y = linear([0, top], [plot.base, plot.top]);
  const x = linear([0, seconds], [plot.left, w]);
  // Each second is drawn at its middle. The last may be short, so its middle is its own.
  const centres = data.speeds.map((_, i) => x(i === n - 1 ? (i + seconds) / 2 : i + 0.5));
  const points: Point[] = shown.map((v, i) => [centres[i] ?? 0, y(v)]);
  // A 5 s average holds its first and last values out to the run's edges, so the line runs edge to edge as the axis does.
  const first = points[0];
  const last = points.at(-1);
  const drawn: Point[] = smooth && first && last ? [[plot.left, first[1]], ...points, [w, last[1]]] : points;
  const line = smooth ? curvePath(drawn) : linePath(drawn);
  const area = areaPath(line, drawn, plot.base);

  const low = shown.reduce((best, v, i) => (v < (shown[best] ?? Infinity) ? i : best), 0);
  const lowPoint = points[low];
  const lowText = String(Math.round(shown[low] ?? 0));
  const lw = measure(lowText, 500);
  const spread = Math.max(...shown) - Math.min(...shown);
  const lowBox = (() => {
    // A low point on a level line is noise with a ring around it.
    if (!lowPoint || n < 3 || spread < LOW_MIN_SPREAD) return null;
    const [px, py] = lowPoint;
    const gap = 9;
    const candidates: Box[] = [
      { x: px - lw / 2, y: py + gap, w: lw, h: plot.lh },
      { x: px + gap + 2, y: py - plot.lh / 2, w: lw, h: plot.lh },
      { x: px - gap - 2 - lw, y: py - plot.lh / 2, w: lw, h: plot.lh },
      { x: px - lw / 2, y: py - gap - plot.lh, w: lw, h: plot.lh },
    ].map((b) => ({ ...b, x: Math.max(plot.left, Math.min(w - lw, b.x)) }));
    const bounds = { x: plot.left, y: 0, w: w - plot.left, h: plot.base };
    return place(
      candidates.filter((b) => clearOfLine(b, drawn, 3)),
      [],
      bounds,
      4,
    );
  })();

  const pxPerSecond = (w - plot.left) / Math.max(1, seconds);
  const xLabels = (() => {
    if (smooth) {
      const labelW = measure("000") + 40;
      const every = TICK_STEPS.find((k) => k * pxPerSecond >= labelW) ?? 600;
      const candidates: AxisLabel[] = [];
      for (let t = 0; t < seconds; t += every) candidates.push({ x: x(t), text: String(t) });
      candidates.push({ x: w, text: s.seconds(Math.round(seconds)) });
      return plotLabels(plot, (width, at) =>
        axisLabels(
          candidates.map((c) => ({ ...c, x: at(c.x) })),
          (t) => measure(t),
          width,
          16,
        ),
      );
    }
    // Each dot is a second, so its number sits under it: second 1 is the first dot, not the line at 0.
    const end = s.seconds(n);
    const room = measure(end) + 16;
    const every = TICK_STEPS.find((k) => k * pxPerSecond >= room) ?? 600;
    const lastX = centres[n - 1] ?? w;
    const candidates: AxisLabel[] = [];
    for (let i = 0; i < n - 1; i++) {
      const at = centres[i] ?? 0;
      if ((i + 1) % every === 0 && lastX - at >= room) candidates.push({ x: at, text: String(i + 1) });
    }
    candidates.push({ x: lastX, text: end });
    return plotLabels(plot, (width, at) =>
      axisLabels(
        candidates.map((c) => ({ ...c, x: at(c.x) })),
        (t) => measure(t),
        width,
        16,
        false,
      ),
    );
  })();

  const scrub = useScrub(centres);
  const at = scrub.at;
  const hovered = at === null ? null : points[at];
  const id = `cx${revealKey.replace(/[^a-z0-9]/gi, "")}`;
  const misses = data.mistakesMs.map((ms) => crisp(Math.min(w - 1, x(ms / 1000)))).filter((v, i, all) => i === 0 || Math.abs(v - (all[i - 1] ?? 0)) >= 1);
  const missPath = misses.map((mx) => `M${mx - 0.5} ${plot.base + 3}h2v${MISS_TICK}h-2z`).join("");

  return (
    <>
      <svg width={w} height={h} aria-hidden="true">
        <YRules ticks={ticks} y={y} plot={plot} />
        <XLabels labels={xLabels} plot={plot} />
      </svg>
      <svg className="cx-data" width={w} height={h} aria-hidden="true">
        <defs>
          <linearGradient id={id} x1="0" x2="0" y1={plot.top} y2={plot.base} gradientUnits="userSpaceOnUse">
            <stop className="cx-stop" offset="0" style={{ stopOpacity: "var(--cx-area)" }} />
            <stop className="cx-stop" offset="1" style={{ stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        {area ? <path d={area} fill={`url(#${id})`} /> : null}
        {missPath ? <path className="cx-miss" d={missPath} /> : null}
        <path className="cx-line" d={line} />
        {smooth ? null : points.map(([px, py], i) => <circle key={i} className="cx-point" cx={px} cy={py} r={3.5} />)}
        {lowPoint && lowBox ? (
          <>
            <circle className="cx-ring" cx={lowPoint[0]} cy={lowPoint[1]} r={4.5} />
            {/* Anchored in SVG at the right edge, as the x labels are, so a measurement a pixel short can't push it past. */}
            <text className="cx-strong" x={lowBox.x + lw >= w ? w : Math.round(lowBox.x)} y={Math.round(lowBox.y + plot.lh - 5)} textAnchor={lowBox.x + lw >= w ? "end" : undefined}>
              {lowText}
            </text>
          </>
        ) : null}
      </svg>
      <svg width={w} height={h} aria-hidden="true">
        <YLabels ticks={ticks} y={y} format={format} plot={plot} px={frame.px} />
      </svg>
      {hovered && at !== null ? (
        <>
          <svg width={w} height={h} aria-hidden="true">
            <path className="cx-cross" d={`M${crisp(hovered[0])} ${plot.top}V${plot.base}`} />
            <circle className="cx-ring" cx={hovered[0]} cy={hovered[1]} r={4.5} />
          </svg>
          <Readout x={hovered[0]} width={w}>
            <b>{s.speedRead(Math.round(shown[at] ?? 0))}</b>
            <span>{s.speedReadSecond(at + 1, data.errors[at] ?? 0)}</span>
          </Readout>
        </>
      ) : null}
      <Hit label={label} scrub={scrub} live={at === null ? "" : `${s.speedRead(Math.round(shown[at] ?? 0))}, ${s.speedReadSecond(at + 1, data.errors[at] ?? 0)}`} />
    </>
  );
}

export function SpeedChart({ data, s, revealKey }: { data: SpeedData; s: ReportStrings; revealKey: string }) {
  const { ref, frame } = useFrame<HTMLDivElement>(revealKey);
  const smooth = data.speeds.length >= SPEED_SMOOTH_MIN_S;
  const shown = smooth ? movingAverage(data.speeds) : data.speeds;
  const hasMisses = data.mistakesMs.length > 0;
  const label = `${s.speedLabel(Math.round(data.elapsedMs / 1000))}${data.finding ? ` ${data.finding}` : ""}`;
  return (
    <section className="rs-full" data-testid="speed-chart">
      <ChartHead
        title={s.speedTitle}
        finding={data.finding}
        note={smooth ? null : s.speedShortNote}
        legend={
          <>
            <span>
              {smooth ? <i className="cx-key-line" /> : <i className="cx-key-swatch" style={{ background: "var(--brand)", borderRadius: "50%" }} />}
              {smooth ? s.legendSpeed : s.legendEachSecond}
            </span>
            {hasMisses ? (
              <span>
                <i className="cx-key-tick" />
                {s.legendMistake}
              </span>
            ) : null}
          </>
        }
      />
      <div ref={ref} className="cx cx-speed">
        {frame ? <Plot data={data} frame={frame} s={s} revealKey={revealKey} label={label} /> : null}
      </div>
      <ChartTable
        caption={s.speedLabel(Math.round(data.elapsedMs / 1000))}
        head={[s.secondHead, smooth ? s.speedAverageHead : s.wpm, s.mistakesHead]}
        rows={shown.map((v, i) => [String(i + 1), String(Math.round(v)), String(data.errors[i] ?? 0)])}
      />
    </section>
  );
}
