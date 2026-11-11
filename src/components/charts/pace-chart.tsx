"use client";

import { useMemo } from "react";
import { nextDecade, PACE_MIN_RUNS, paceSeries, type TimedRun } from "@/engine/analysis";
import type { ReportStrings } from "@/i18n/report";
import { plotOf, rulesTaken, XLabels, YLabels, YRules } from "./axes";
import { ChartHead, ChartTable, type Frame, Hit, Readout, useFrame, useScrub } from "./frame";
import { areaPath, crisp, linePath, type Point, splitAt } from "./geometry";
import { axisLabels, type Box, place, strideLabels } from "./labels";
import { linear, niceTicks, quantile } from "./scale";
import "./charts.css";

const DAY_MS = 86_400_000;
/** Below two weeks a date axis squeezes everything into a corner, so runs are spaced evenly instead. */
export const TIME_AXIS_MIN_DAYS = 14;
/** A gap this long breaks the line: Pace didn't move while nobody typed, and a line across it would say it did. */
export const BREAK_DAYS = 14;
// Tukey's far-out fences: a run past three interquartile ranges from the middle half is a stray, and the range ignores it so
// one run can't flatten everything else. Slow early runs are history, not strays, and stay in.
const FENCE = 3;

export interface PaceDates {
  /** "Tue 4 Nov" */
  day(t: number): string;
  /** "nov" */
  month(t: number): string;
  /** Local midnight of the day t falls in. */
  dayStart(t: number): number;
}

interface Target {
  x: number;
  title: string;
  value: string;
  sub: string;
  y: number | null;
}

export interface PaceModel {
  byDate: boolean;
  domain: [number, number];
  xOf(i: number): number;
  series: { i: number; pace: number }[];
  low: number;
  high: number;
  step: number;
}

/** The pieces of the Pace chart that don't depend on pixels, kept apart so they can be tested. */
export function paceModel(runs: readonly TimedRun[], now: number): PaceModel {
  const first = runs[0]?.t ?? now;
  const last = runs.at(-1)?.t ?? first;
  const byDate = last - first >= TIME_AXIS_MIN_DAYS * DAY_MS;
  const slots = Math.max(runs.length, PACE_MIN_RUNS);
  const domain: [number, number] = byDate ? [first, Math.max(last, now)] : [-0.5, slots - 0.5];
  const xOf = (i: number) => (byDate ? (runs[i]?.t ?? 0) : i);
  const raw = paceSeries(runs);
  const offset = runs.length - raw.length;
  const series = raw.map((p, k) => ({ i: k + offset, pace: p.pace }));
  const speeds = runs.map((r) => r.wpmCx / 100).sort((a, b) => a - b);
  const q1 = quantile(speeds, 0.25);
  const q3 = quantile(speeds, 0.75);
  const inside = speeds.filter((v) => v >= q1 - FENCE * (q3 - q1) && v <= q3 + FENCE * (q3 - q1));
  let low = inside[0] ?? speeds[0] ?? 0;
  let high = inside.at(-1) ?? speeds.at(-1) ?? 0;
  for (const p of series) {
    low = Math.min(low, p.pace);
    high = Math.max(high, p.pace);
  }
  const current = series.at(-1)?.pace;
  if (current !== undefined) high = Math.max(high, nextDecade(current).target);
  // Rules every 10, until a very wide range would turn them into stripes.
  const step = high - low > 80 ? 20 : 10;
  return { byDate, domain, xOf, series, low, high, step };
}

function Plot({ runs, now, frame, s, one, dates, label, revealKey }: { runs: readonly TimedRun[]; now: number; frame: Frame; s: ReportStrings; one(n: number): string; dates: PaceDates; label: string; revealKey: string }) {
  const p = s.progress;
  const { w, h, measure } = frame;
  const model = useMemo(() => paceModel(runs, now), [runs, now]);
  const plot = plotOf(w, h, frame.px);
  const ticks = niceTicks(model.low, model.high, 99, model.step).values;
  const y = linear([ticks[0] ?? 0, ticks.at(-1) ?? 1], [plot.base, plot.top]);
  const x = linear(model.domain, [0, w]);
  const xi = (i: number) => x(model.xOf(i));
  const format = (v: number) => String(v);
  const hasLine = model.series.length > 0;

  // Dots outside the fitted range sit on its edge as rings: still there, plainly beyond the scale.
  const lowEdge = ticks[0] ?? 0;
  const highEdge = ticks.at(-1) ?? 1;
  let dots = "";
  let beyond = "";
  runs.forEach((run, i) => {
    const v = run.wpmCx / 100;
    const cx = Math.round(xi(i) * 2) / 2;
    if (v < lowEdge || v > highEdge) beyond += `M${cx - 2.5} ${v > highEdge ? plot.top : plot.base}a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0`;
    else dots += `M${cx - 2} ${Math.round(y(v) * 2) / 2}a2 2 0 1 0 4 0a2 2 0 1 0 -4 0`;
  });

  const segments = splitAt(model.series, (q) => model.xOf(q.i), model.byDate ? BREAK_DAYS * DAY_MS : Infinity);
  const paths = segments.map((seg) => {
    const pts: Point[] = seg.map((q) => [xi(q.i), y(q.pace)]);
    const line = linePath(pts);
    return { pts, line, area: areaPath(line, pts, plot.base) };
  });
  const bridges = paths.slice(1).map((path, k) => {
    const a = paths[k]?.pts.at(-1);
    const b = path.pts[0];
    return a && b ? `M${a[0]} ${a[1]}L${b[0]} ${b[1]}` : "";
  });

  const end = model.series.at(-1);
  const endPoint: Point | null = end ? [xi(end.i), y(end.pace)] : null;
  const target = end ? nextDecade(end.pace).target : null;
  const rules: Box[] = rulesTaken(ticks, y, format, measure, plot);
  // The end value must not sit on the dashed target, where the dashes would strike it through.
  const taken: Box[] = target === null ? [...rules] : [...rules, { x: 0, y: y(target) - 1, w, h: 2 }];
  const bounds = { x: 0, y: 0, w, h: plot.base };
  let endBox: Box | null = null;
  const endText = end ? one(end.pace) : "";
  if (endPoint) {
    const ew = measure(endText, 500);
    const [ex, ey] = endPoint;
    const right = Math.min(w, ex + ew / 2) - ew;
    endBox = place(
      [
        { x: Math.min(right, ex - 10 - ew), y: ey - 10 - plot.lh, w: ew, h: plot.lh },
        { x: Math.min(right, ex - 10 - ew), y: ey + 10, w: ew, h: plot.lh },
        { x: ex - 12 - ew, y: ey - plot.lh / 2, w: ew, h: plot.lh },
      ],
      taken,
      bounds,
    );
  }
  let targetBox: Box | null = null;
  const targetText = target === null ? "" : p.decadeLabel(target);
  if (target !== null && target <= highEdge) {
    const tw = measure(targetText);
    const ty = y(target);
    targetBox = place(
      [
        { x: w - tw, y: ty - plot.pad - plot.lh + 4, w: tw, h: plot.lh },
        { x: w - tw, y: ty + plot.pad - 2, w: tw, h: plot.lh },
      ],
      endBox ? [...rules, endBox] : rules,
      // The top rule's label line is free on the right, so the label may use it.
      { x: 0, y: -plot.pad, w, h: plot.base + plot.pad },
      2,
    );
  }

  // Hover by day on a date axis, by run on a run axis.
  const targets: Target[] = useMemo(() => {
    const paceAt = new Map(model.series.map((q) => [q.i, q.pace]));
    if (!model.byDate) {
      return runs.map((run, i) => {
        const pace = paceAt.get(i);
        return { x: i, title: p.runNumber(i + 1), value: pace === undefined ? `${one(run.wpmCx / 100)} ${s.wpm}` : p.paceRead(one(pace)), sub: pace === undefined ? dates.day(run.t) : p.runRead(one(run.wpmCx / 100)), y: pace ?? run.wpmCx / 100 };
      });
    }
    const out: Target[] = [];
    let at = 0;
    while (at < runs.length) {
      const start = dates.dayStart(runs[at]?.t ?? 0);
      let next = at;
      let best = 0;
      while (next < runs.length && dates.dayStart(runs[next]?.t ?? 0) === start) {
        best = Math.max(best, (runs[next]?.wpmCx ?? 0) / 100);
        next++;
      }
      const lastRun = runs[next - 1] as TimedRun;
      const pace = paceAt.get(next - 1);
      out.push({ x: lastRun.t, title: dates.day(lastRun.t), value: pace === undefined ? `${one(best)} ${s.wpm}` : p.paceRead(one(pace)), sub: p.paceDay(next - at, one(best)), y: pace ?? best });
      at = next;
    }
    return out;
  }, [runs, model, dates, one, p, s.wpm]);

  const xs = targets.map((t) => x(t.x));
  const scrub = useScrub(xs);
  const hovered = scrub.at === null ? null : targets[scrub.at];

  const monthLabels = (() => {
    if (!model.byDate) {
      return axisLabels(
        [
          { x: x(0), text: "1" },
          { x: w, text: p.runOfMany(Math.max(runs.length, PACE_MIN_RUNS)) },
        ],
        (t) => measure(t),
        w,
        16,
      );
    }
    const candidates = [];
    const cursor = new Date(model.domain[0]);
    cursor.setDate(1);
    cursor.setHours(0, 0, 0, 0);
    for (; cursor.getTime() <= model.domain[1]; cursor.setMonth(cursor.getMonth() + 1)) {
      const t = cursor.getTime();
      // A month starting at the left edge is labelled where it starts; one before it has no room to say so.
      if (t >= model.domain[0]) candidates.push({ x: x(t), text: dates.month(t + 12 * 3_600_000) });
    }
    return strideLabels(candidates, (t) => measure(t), w, 20);
  })();

  const id = `cx${revealKey.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <>
      <svg width={w} height={h} aria-hidden="true">
        <YRules ticks={ticks.filter((v) => v !== target)} y={y} plot={plot} />
        {target !== null && target <= highEdge ? <path className="cx-dashed" d={`M0 ${crisp(y(target))}H${w}`} /> : null}
        <XLabels labels={monthLabels} plot={plot} />
      </svg>
      <svg className="cx-data" width={w} height={h} aria-hidden="true">
        <defs>
          <linearGradient id={id} x1="0" x2="0" y1={plot.top} y2={plot.base} gradientUnits="userSpaceOnUse">
            <stop className="cx-stop" offset="0" style={{ stopOpacity: "var(--cx-area)" }} />
            <stop className="cx-stop" offset="1" style={{ stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        {hasLine ? paths.map((path, k) => (path.area ? <path key={k} d={path.area} fill={`url(#${id})`} /> : null)) : null}
        {dots && hasLine ? <path className="cx-dots" d={dots} /> : null}
        {hasLine ? null : runs.map((run, i) => (run.wpmCx / 100 >= lowEdge && run.wpmCx / 100 <= highEdge ? <circle key={i} className="cx-point" cx={xi(i)} cy={y(run.wpmCx / 100)} r={4} /> : null))}
        {beyond ? <path className="cx-beyond" d={beyond} /> : null}
        {bridges.map((d, k) => (d ? <path key={k} className="cx-bridge" d={d} /> : null))}
        {paths.map((path, k) => (path.pts.length > 1 ? <path key={k} className="cx-line" d={path.line} /> : path.pts[0] ? <circle key={k} className="cx-point" cx={path.pts[0][0]} cy={path.pts[0][1]} r={3} /> : null))}
        {endPoint ? <circle className="cx-ring" cx={endPoint[0]} cy={endPoint[1]} r={4.5} /> : null}
        {endBox ? (
          <text className="cx-strong" x={endBox.x + endBox.w >= w ? w : Math.round(endBox.x)} y={Math.round(endBox.y + plot.lh - 5)} textAnchor={endBox.x + endBox.w >= w ? "end" : undefined}>
            {endText}
          </text>
        ) : null}
      </svg>
      <svg width={w} height={h} aria-hidden="true">
        <YLabels ticks={ticks} y={y} format={format} plot={plot} />
        {targetBox ? (
          <text className="cx-y" x={w} y={Math.round(targetBox.y + plot.lh - 5)} textAnchor="end">
            {targetText}
          </text>
        ) : null}
      </svg>
      {hovered ? (
        <>
          <svg width={w} height={h} aria-hidden="true">
            <path className="cx-cross" d={`M${crisp(x(hovered.x))} ${plot.top}V${plot.base}`} />
            {hovered.y !== null && hovered.y >= lowEdge && hovered.y <= highEdge ? <circle className="cx-ring" cx={x(hovered.x)} cy={y(hovered.y)} r={4.5} /> : null}
          </svg>
          <Readout x={x(hovered.x)} width={w}>
            <b>{hovered.value}</b>
            <span>{hovered.title}</span>
            <span>{hovered.sub}</span>
          </Readout>
        </>
      ) : null}
      <Hit label={label} scrub={scrub} live={hovered ? `${hovered.title}: ${hovered.value}, ${hovered.sub}` : ""} />
    </>
  );
}

export function PaceChart({ runs, now, finding, s, one, dates, revealKey }: { runs: readonly TimedRun[]; now: number; finding: string | null; s: ReportStrings; one(n: number): string; dates: PaceDates; revealKey: string }) {
  const p = s.progress;
  const { ref, frame } = useFrame<HTMLDivElement>(revealKey);
  const series = useMemo(() => paceSeries(runs), [runs]);
  const offset = runs.length - series.length;
  const label = `${p.paceChartLabel}${finding ? ` ${finding}` : ""}`;
  return (
    <section className="cx-cell rs-main" data-testid="pace-chart">
      <ChartHead
        title={p.paceChart}
        finding={finding}
        findingId="pace-finding"
        note={series.length === 0 ? p.paceFewNote : null}
        legend={
          series.length > 0 ? (
            <>
              <span>
                <i className="cx-key-dot" />
                {p.legendRun}
              </span>
              <span>
                <i className="cx-key-line" />
                {p.paceChart}
              </span>
            </>
          ) : null
        }
      />
      <div ref={ref} className="cx cx-pace">
        {frame ? <Plot runs={runs} now={now} frame={frame} s={s} one={one} dates={dates} label={label} revealKey={revealKey} /> : null}
      </div>
      <ChartTable
        caption={p.paceChartLabel}
        head={[p.when, s.wpm, p.paceUnit]}
        rows={runs.map((run, i) => [dates.day(run.t), one(run.wpmCx / 100), i >= offset ? one(series[i - offset]?.pace ?? 0) : ""])}
      />
    </section>
  );
}
