"use client";

import type { AccuracyWeek } from "@/components/progress/model";
import type { ReportStrings } from "@/i18n/report";
import { gutterOf, plotLabels, plotOf, XLabels, YLabels, YRules } from "./axes";
import { ChartHead, ChartTable, type Frame, Hit, Readout, useFrame, useScrub } from "./frame";
import { crisp, linePath, type Point, splitAt } from "./geometry";
import { type AxisLabel, axisLabels, strideLabels } from "./labels";
import { linear, niceTicks, quantile } from "./scale";
import "./charts.css";

/** Three weeks make a line. Fewer, and each run is shown as it was. */
export const ACCURACY_MIN_WEEKS = 3;
export const ACCURACY_MIN_RUNS = 5;
const DAY_MS = 86_400_000;

export interface AccuracyRun {
  t: number;
  accuracy: number;
}

/** Week starts are UTC midnights of local day strings, so these format in UTC. */
export interface AccuracyDates {
  /** "3 nov" */
  short(t: number): string;
  month(t: number): string;
  /** "Tue 4 Nov", for a run's own time. */
  day(t: number): string;
}

// Accuracy moves by fractions of a percent from week to week. Over a narrower range half a percent fills a quarter of the
// plot and reads as a swing.
const ACCURACY_MIN_SPAN = 5;

/** A range fitted to the data: whole percents, at least five apart and centred on the data when it is narrower, never past 100. */
export function accuracyTicks(low: number, high: number): number[] {
  let lo = Math.floor(low);
  let hi = Math.min(100, Math.ceil(high));
  if (hi - lo < ACCURACY_MIN_SPAN) {
    const mid = (low + high) / 2;
    lo = Math.floor(mid - ACCURACY_MIN_SPAN / 2);
    hi = Math.ceil(mid + ACCURACY_MIN_SPAN / 2);
    if (hi > 100) {
      lo -= hi - 100;
      hi = 100;
    }
  }
  const ticks = niceTicks(lo, hi, 4, undefined, 1);
  // 2.5 would put 97.5% on a rule.
  return ticks.step % 1 === 0 ? ticks.values : niceTicks(lo, hi, 4, 5).values;
}

/** What the weeks say, or the runs while there are too few weeks: the range most of them sit in. */
export function accuracySpan(values: readonly number[]): [number, number] | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return [Math.round(quantile(sorted, 0.1)), Math.round(quantile(sorted, 0.9))];
}

const weekMs = (w: AccuracyWeek) => Date.UTC(1970, 0, 1) + w.n * DAY_MS;

function Plot({ weeks, runs, frame, s, one, dates, label, revealKey }: { weeks: readonly AccuracyWeek[]; runs: readonly AccuracyRun[]; frame: Frame; s: ReportStrings; one(n: number): string; dates: AccuracyDates; label: string; revealKey: string }) {
  const p = s.progress;
  const { w, h, measure } = frame;
  const weekly = weeks.length >= ACCURACY_MIN_WEEKS;
  const values = weekly ? weeks.flatMap((wk) => [wk.q1, wk.q3]) : runs.map((r) => r.accuracy);
  const ticks = accuracyTicks(Math.min(...values), Math.max(...values));
  const format = (v: number) => `${v}%`;
  const plot = plotOf(w, h, frame.px, gutterOf(ticks, format, measure));
  const y = linear([ticks[0] ?? 0, ticks.at(-1) ?? 100], [plot.base, plot.top]);
  const slots = Math.max(runs.length, ACCURACY_MIN_RUNS);
  const x = weekly ? linear([weekMs(weeks[0] as AccuracyWeek), weekMs(weeks.at(-1) as AccuracyWeek)], [plot.left, w]) : linear([-0.5, slots - 0.5], [plot.left, w]);

  // A bucket with no runs between two others breaks the line.
  const span = weeks[0]?.span ?? 1;
  const segments = weekly ? splitAt(weeks, (wk) => wk.n * DAY_MS, 14 * span * DAY_MS) : [];
  const shapes = segments.map((seg) => {
    const mid: Point[] = seg.map((wk) => [x(weekMs(wk)), y(wk.median)]);
    const upper: Point[] = seg.map((wk) => [x(weekMs(wk)), y(wk.q3)]);
    const lower: Point[] = seg.map((wk): Point => [x(weekMs(wk)), y(wk.q1)]).reverse();
    // Straight, all three: a curve between buckets suggests readings that were never taken, and a curved median can leave a
    // straight band between two points.
    const band = upper.length > 1 ? `${linePath(upper)}${linePath(lower).replace("M", "L")}Z` : "";
    return { mid, line: linePath(mid), band };
  });
  const bridges = shapes.slice(1).map((shape, k) => {
    const a = shapes[k]?.mid.at(-1);
    const b = shape.mid[0];
    return a && b ? `M${a[0]} ${a[1]}L${b[0]} ${b[1]}` : "";
  });

  const xs = weekly ? weeks.map((wk) => x(weekMs(wk))) : runs.map((_, i) => x(i));
  const scrub = useScrub(xs);
  const at = scrub.at;
  const read = (() => {
    if (at === null) return null;
    if (weekly) {
      const wk = weeks[at];
      if (!wk) return null;
      return { x: x(weekMs(wk)), y: y(wk.median), value: `${one(wk.median)}%`, title: p.weekOf(dates.short(weekMs(wk)), wk.span), sub: p.weekRead(wk.runs, one(wk.q1), one(wk.q3), one(wk.low), one(wk.high)) };
    }
    const run = runs[at];
    if (!run) return null;
    return { x: x(at), y: y(run.accuracy), value: `${one(run.accuracy)}%`, title: p.runNumber(at + 1), sub: dates.day(run.t) };
  })();

  const labels = weekly
    ? (() => {
        const first = weekMs(weeks[0] as AccuracyWeek);
        const last = weekMs(weeks.at(-1) as AccuracyWeek);
        const out: AxisLabel[] = [];
        const cursor = new Date(first);
        cursor.setUTCDate(1);
        for (; cursor.getTime() <= last; cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
          if (cursor.getTime() >= first) out.push({ x: x(cursor.getTime()), text: dates.month(cursor.getTime() + 12 * 3_600_000) });
        }
        return plotLabels(plot, (width, at) =>
          strideLabels(
            out.map((c) => ({ ...c, x: at(c.x) })),
            (t) => measure(t),
            width,
            24,
          ),
        );
      })()
    : plotLabels(plot, (width, at) =>
        axisLabels(
          [
            { x: at(x(0)), text: "1" },
            { x: width, text: p.runOfMany(slots) },
          ],
          (t) => measure(t),
          width,
          16,
        ),
      );

  const id = `cx${revealKey.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <>
      <svg width={w} height={h} aria-hidden="true">
        <YRules ticks={ticks} y={y} plot={plot} />
        <XLabels labels={labels} plot={plot} />
      </svg>
      <svg className="cx-data" width={w} height={h} aria-hidden="true" id={id}>
        {shapes.map((shape, k) => (shape.band ? <path key={k} className="cx-band" d={shape.band} /> : null))}
        {bridges.map((d, k) => (d ? <path key={k} className="cx-bridge" d={d} /> : null))}
        {shapes.map((shape, k) => (shape.mid.length > 1 ? <path key={k} className="cx-line" d={shape.line} /> : shape.mid[0] ? <circle key={k} className="cx-point" cx={shape.mid[0][0]} cy={shape.mid[0][1]} r={3} /> : null))}
        {weekly ? null : runs.map((run, i) => <circle key={i} className="cx-point" cx={x(i)} cy={y(run.accuracy)} r={3.5} />)}
      </svg>
      <svg width={w} height={h} aria-hidden="true">
        <YLabels ticks={ticks} y={y} format={format} plot={plot} px={frame.px} />
      </svg>
      {read ? (
        <>
          <svg width={w} height={h} aria-hidden="true">
            <path className="cx-cross" d={`M${crisp(read.x)} ${plot.top}V${plot.base}`} />
            <circle className="cx-ring" cx={read.x} cy={read.y} r={4.5} />
          </svg>
          <Readout x={read.x} width={w}>
            <b>{read.value}</b>
            <span>{read.title}</span>
            <span>{read.sub}</span>
          </Readout>
        </>
      ) : null}
      <Hit label={label} scrub={scrub} live={read ? `${read.title}: ${read.value}, ${read.sub}` : ""} />
    </>
  );
}

export function AccuracyChart({ weeks, runs, s, one, dates, revealKey }: { weeks: readonly AccuracyWeek[]; runs: readonly AccuracyRun[]; s: ReportStrings; one(n: number): string; dates: AccuracyDates; revealKey: string }) {
  const p = s.progress;
  const { ref, frame } = useFrame<HTMLDivElement>(revealKey);
  const weekly = weeks.length >= ACCURACY_MIN_WEEKS;
  const span = weekly ? accuracySpan(weeks.map((wk) => wk.median)) : null;
  // Too few weeks for "most": a handful of runs is said whole, so no run sits outside the sentence.
  const values = runs.map((r) => r.accuracy);
  const finding = span ? p.accuracyWeeks(span[0], span[1]) : !weekly && runs.length >= ACCURACY_MIN_RUNS ? p.accuracyRange(one(Math.min(...values)), one(Math.max(...values))) : null;
  const label = `${p.accuracyLabel}${finding ? ` ${finding}` : ""}`;
  return (
    <section className="cx-cell" data-testid="accuracy-chart">
      <ChartHead title={p.accuracyChart} finding={finding} note={weekly ? p.accuracyNote(weeks[0]?.span ?? 1) : null} />
      <div ref={ref} className="cx cx-accuracy">
        {frame ? <Plot weeks={weeks} runs={runs} frame={frame} s={s} one={one} dates={dates} label={label} revealKey={revealKey} /> : null}
      </div>
      <ChartTable
        caption={p.accuracyLabel}
        head={weekly ? [p.weekHead, p.medianHead, p.middleHalfHead, p.runs] : [p.when, s.accuracy]}
        rows={weekly ? weeks.map((wk) => [dates.short(weekMs(wk)), `${one(wk.median)}%`, p.weekSpan(one(wk.q1), one(wk.q3)), String(wk.runs)]) : runs.map((r) => [dates.day(r.t), `${one(r.accuracy)}%`])}
      />
    </section>
  );
}
