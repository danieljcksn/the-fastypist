"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { LineChart, type XY } from "@/components/charts/line-chart";
import { rulesFor } from "@/components/charts/scale";
import { heroBearing } from "@/components/typing/result-fallback";
import { currentPace, type LetterPair, monthInsight, movingAverage, nextDecade, PACE_MIN_RUNS, paceSeries, paceTrend, pairsAcrossRuns, percentileOf, type TimedRun } from "@/engine/analysis";
import { decodeLog } from "@/engine/log";
import type { Language } from "@/engine/packs";
import { href, type Lang } from "@/i18n";
import { formatter, type ReportStrings, reportStrings } from "@/i18n/report";
import { allRaw } from "@/typing/history/raw";
import { countsForPace, type HistoryRow } from "@/typing/history/rows";
import { EMPTY_HISTORY, loadHistory, subscribeHistory } from "@/typing/history/summaries";
import { CalendarChart } from "./calendar";
import { type BestRow, bestRows, calendarOf, languagesOf, recentAccuracy, timeTypedMs } from "./model";
import "@/components/charts/report.css";

const DAY_MS = 86_400_000;
const PAIR_ROWS = 5;
const DRILL_PAIRS = 3;
const TIME_AXIS_MIN_DAYS = 14;
const MONTH_LABEL_MIN_GAP = 0.09;
const ACCURACY_MIN_RUNS = 5;
const ACCURACY_WINDOW_MIN = 5;
const ACCURACY_WINDOW_MAX = 25;

function dateParts(locale: string) {
  const month = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });
  const long = new Intl.DateTimeFormat(locale, { month: "long" });
  const shortMonth = (date: Date) => month.format(date).replace(".", "").toLowerCase();
  return {
    monthOfDay: (day: string) => shortMonth(new Date(`${day}T00:00:00Z`)),
    dayLabel: (day: string) => {
      const date = new Date(`${day}T00:00:00Z`);
      return `${date.getUTCDate()} ${shortMonth(date)}`;
    },
    /** January rather than jan, for a sentence. English capitalises it and Portuguese does not, and Intl knows. */
    longMonth: (t: number) => long.format(t),
    shortMonth,
  };
}

interface Axis {
  xOf(i: number, t: number): number;
  domain: readonly [number, number];
  labels: { x: number; text: string }[];
}

/** By date once there are two weeks to spread over. Before that a date axis squeezes everything into a corner, so runs are spaced evenly. */
function axisFor(times: readonly number[], s: ReportStrings, shortMonth: (d: Date) => string, slots: number, narrow: boolean): Axis {
  const first = times[0] ?? 0;
  const last = times.at(-1) ?? first;
  if (last - first < TIME_AXIS_MIN_DAYS * DAY_MS) {
    // Half a slot of air at each end, so the first dot doesn't land on the rule's label.
    const end = Math.max(times.length, slots) - 0.5;
    return {
      xOf: (i) => i,
      domain: [-0.5, end],
      labels: [
        { x: -0.5, text: "1" },
        { x: end, text: s.progress.runOfMany(end + 0.5) },
      ],
    };
  }
  const labels: { x: number; text: string }[] = [];
  const cursor = new Date(first);
  cursor.setDate(1);
  cursor.setHours(0, 0, 0, 0);
  const span = last - first;
  let previous = -1;
  for (; cursor.getTime() <= last; cursor.setMonth(cursor.getMonth() + 1)) {
    const at = (cursor.getTime() - first) / span;
    if (at < 0 || at - previous < MONTH_LABEL_MIN_GAP) continue;
    previous = at;
    labels.push({ x: cursor.getTime(), text: shortMonth(new Date(cursor.getTime() + 12 * 3_600_000)) });
  }
  if (narrow && labels.length > 2) labels.splice(1, labels.length - 2);
  return { xOf: (_, t) => t, domain: [first, last], labels };
}

function PaceChart({ runs, now, s, one, longMonth, shortMonth }: { runs: readonly TimedRun[]; now: number; s: ReportStrings; one(n: number): string; longMonth(t: number): string; shortMonth(d: Date): string }) {
  const p = s.progress;
  const series = useMemo(() => paceSeries(runs), [runs]);
  const times = runs.map((r) => r.t);
  const axis = axisFor(times, s, shortMonth, PACE_MIN_RUNS, false);
  const dots: XY[] = runs.map((r, i) => ({ x: axis.xOf(i, r.t), y: r.wpmCx / 100 }));
  const offset = runs.length - series.length;
  const line: XY[] = series.map((point, i) => ({ x: axis.xOf(i + offset, point.t), y: point.pace }));
  const values = [...dots, ...line].map((point) => point.y);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // Rules every 10, as the contract says, until a very wide range would turn them into stripes.
  const rules = rulesFor(min, max, 99, max - min > 60 ? 20 : 10);
  const trend = useMemo(() => paceTrend(series), [series]);
  const insight = useMemo(() => monthInsight(runs, now), [runs, now]);
  let finding: string | null = null;
  if (insight) finding = p.insight(insight, insight.kind === "same" ? "" : one(insight.wpm));
  else if (trend) finding = p.trend(one(Math.abs(trend.wpm)), trend.wpm > 0, longMonth(trend.since));
  const end = line.at(-1);
  return (
    <section className="rs-main" data-testid="pace-chart">
      <h2 className="rs-title">{p.paceChart}</h2>
      {finding ? (
        <p className="rs-finding" data-testid="pace-finding">
          {finding}
        </p>
      ) : null}
      <LineChart
        label={`${p.paceChartLabel} ${finding ?? ""}`}
        line={line}
        dots={dots}
        rules={rules}
        formatRule={(v) => String(v)}
        xDomain={axis.domain}
        xLabels={axis.labels}
        marker={end ? { x: end.x, y: end.y, text: one(end.y) } : undefined}
        readout={(point) => `${one(point.y)} ${s.wpm}`}
      />
    </section>
  );
}

function AccuracyChart({ rows, s, one, shortMonth }: { rows: readonly HistoryRow[]; s: ReportStrings; one(n: number): string; shortMonth(d: Date): string }) {
  const p = s.progress;
  const free = useMemo(() => rows.filter((row) => row.kind === "free"), [rows]);
  if (free.length === 0) return <div />;
  const values = free.map((row) => row.accuracyBp / 100);
  const axis = axisFor(free.map((row) => row.finishedAt), s, shortMonth, ACCURACY_MIN_RUNS, true);
  const enough = free.length >= ACCURACY_MIN_RUNS;
  // A window that grows with the history, or 200 runs of ordinary variation reads as a seismograph.
  const smooth = movingAverage(values, Math.min(ACCURACY_WINDOW_MAX, Math.max(ACCURACY_WINDOW_MIN, Math.floor(values.length / 8))));
  const low = Math.round(Math.min(...smooth));
  const high = Math.round(Math.max(...smooth));
  const finding = enough ? p.accuracyRange(low, high) : null;
  const line: XY[] = enough ? smooth.map((y, i) => ({ x: axis.xOf(i, free[i]?.finishedAt ?? 0), y })) : [];
  const dots: XY[] = enough ? [] : values.map((y, i) => ({ x: axis.xOf(i, free[i]?.finishedAt ?? 0), y }));
  const shown = enough ? smooth : values;
  return (
    <section data-testid="accuracy-chart">
      <h2 className="rs-title">{p.accuracyChart}</h2>
      {finding ? <p className="rs-finding">{finding}</p> : null}
      <LineChart
        label={`${p.accuracyLabel} ${finding ?? ""}`}
        line={line}
        dots={dots}
        rules={rulesFor(Math.min(...shown), Math.min(100, Math.max(...shown)))}
        formatRule={(v) => `${v}`}
        xDomain={axis.domain}
        xLabels={axis.labels}
        readout={(point) => `${one(point.y)}%`}
      />
    </section>
  );
}

function SlowPairs({ pairs, lang, language, s, one }: { pairs: readonly LetterPair[]; lang: Lang; language: Language; s: ReportStrings; one(n: number): string }) {
  const p = s.progress;
  const rows = pairs.filter((pair) => pair.costWpm > 0).slice(0, PAIR_ROWS);
  const top = rows[0];
  if (!top) return null;
  const finding = p.pairsFinding(top.pair, top.costWpm, (n) => String(n));
  const drill = rows.slice(0, DRILL_PAIRS).map((pair) => pair.pair);
  const query = new URLSearchParams({ drill: drill.join(","), lang: language }).toString();
  return (
    <section data-testid="progress-pairs">
      <h2 className="rs-title">{s.slowestPairs}</h2>
      {finding ? <p className="rs-finding">{finding}</p> : null}
      <table className="pg-pairs">
        <thead className="sr-only">
          <tr>
            <th scope="col">{s.pair}</th>
            <th scope="col">ms</th>
            <th scope="col">{s.wpm}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((pair) => (
            <tr key={pair.pair}>
              <td className="rs-pair" translate="no">
                {pair.pair}
              </td>
              <td>{s.ms(String(Math.round(pair.meanMs)))}</td>
              <td>
                {one(pair.costWpm)} {s.wpm}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Link className="tp-ctl pg-drill" data-testid="drill-these" href={`${href(lang, "/")}?${query}`}>
        {p.drillThese}
      </Link>
    </section>
  );
}

function BestsTable({ rows, today, s, one, label }: { rows: readonly BestRow[]; today: string; s: ReportStrings; one(n: number): string; label(at: number): { day: string; text: string } }) {
  const p = s.progress;
  return (
    <section className="rs-main" data-testid="bests">
      <h2 className="rs-title">{p.bestsTitle}</h2>
      <table className="pg-bests">
        <thead>
          <tr>
            <th scope="col">{p.test}</th>
            <th scope="col">{s.wpm}</th>
            <th scope="col">{s.accuracy}</th>
            <th scope="col">{p.when}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const when = label(row.finishedAt);
            return (
              <tr key={row.key}>
                <td>{p.bestLabel(row.mode, row.amount, row.tier, row.mods)}</td>
                <td>{one(row.wpmCx / 100)}</td>
                <td>{one(row.accuracyBp / 100)}%</td>
                <td>{when.day === today ? p.today : when.text}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function Empty({ lang, s }: { lang: Lang; s: ReportStrings }) {
  const p = s.progress;
  return (
    <section className="pg-empty" data-testid="progress-empty">
      <h1 className="pg-statement">{p.emptyTitle}</h1>
      <p className="pg-empty-body">{p.emptyBody}</p>
      <Link className="rs-btn rs-primary pg-start" href={href(lang, "/")}>
        {p.emptyAction}
      </Link>
    </section>
  );
}

export function ProgressBody({ lang }: { lang: Lang }) {
  const s = reportStrings(lang);
  const p = s.progress;
  const history = useSyncExternalStore(subscribeHistory, loadHistory, () => EMPTY_HISTORY);

  // The static page was served with the zero state hidden, on the strength of the script in the page.
  useLayoutEffect(() => {
    delete document.documentElement.dataset.history;
  }, []);

  const now = history.readAt;

  const languages = useMemo(() => languagesOf(history.rows), [history.rows]);
  const home: Language = lang === "pt-br" ? "pt" : "en";
  const [picked, setPicked] = useState<Language | null>(null);
  const latest = history.rows.at(-1)?.language;
  const language: Language = picked && languages.includes(picked) ? picked : languages.includes(home) ? home : (latest ?? home);

  const rows = useMemo(() => history.rows.filter((row) => row.language === language), [history.rows, language]);
  const paceRuns = useMemo<TimedRun[]>(() => rows.filter(countsForPace).map((row) => ({ t: row.finishedAt, wpmCx: row.wpmCx })), [rows]);
  const pace = useMemo(() => currentPace(paceRuns, now), [paceRuns, now]);

  const [pairs, setPairs] = useState<{ language: Language; rows: number; pairs: LetterPair[] } | null>(null);
  useEffect(() => {
    let live = true;
    void allRaw().then((raws) => {
      if (!live) return;
      const logs = raws
        .filter((raw) => raw.language === language && !raw.drill)
        .flatMap((raw) => {
          const entries = decodeLog(raw.log);
          return entries === null ? [] : [{ cfg: raw.cfg, words: raw.words, entries }];
        });
      setPairs({ language, rows: rows.length, pairs: pairsAcrossRuns(logs) });
    });
    return () => {
      live = false;
    };
  }, [language, rows.length]);

  const one = useMemo(() => formatter(lang === "pt-br" ? "pt-BR" : "en", 1), [lang]);
  const dates = useMemo(() => dateParts(lang === "pt-br" ? "pt-BR" : "en"), [lang]);
  const dayFormat = useMemo(() => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }), []);
  const today = dayFormat.format(now);
  const calendar = useMemo(() => calendarOf(rows, today), [rows, today]);
  const bests = useMemo(() => bestRows(history.bests, language), [history.bests, language]);

  if (history.rows.length === 0) return <Empty lang={lang} s={s} />;

  const accuracy = recentAccuracy(rows);
  const heroText = pace === null ? null : one(pace);
  const decade = pace === null ? null : nextDecade(pace);
  const freeRuns = rows.filter((row) => row.kind === "free").length;

  return (
    <div className="pg" data-testid="progress">
      <div className="rs-top pg-top">
        {heroText !== null ? (
          <h1 className="rs-hero">
            <span className="rs-n pg-n" data-testid="pace" style={{ marginLeft: heroBearing(heroText) }}>
              {heroText}
            </span>
            <span className="rs-unit pg-unit">{p.paceUnit}</span>
          </h1>
        ) : (
          <h1 className="rs-hero pg-statement" data-testid="pace-few">
            {p.fewRuns(paceRuns.length, PACE_MIN_RUNS)}
          </h1>
        )}
        <dl className="rs-stats">
          {accuracy !== null ? (
            <>
              <dt>{s.accuracy}</dt>
              <dd>{one(accuracy)}%</dd>
            </>
          ) : null}
          <dt>{p.timeTyped}</dt>
          <dd data-testid="time-typed">{p.duration(timeTypedMs(rows))}</dd>
          <dt>{p.runs}</dt>
          <dd data-testid="run-count">{freeRuns}</dd>
        </dl>
        {pace !== null && decade !== null ? (
          <p className="rs-say">
            <span className="rs-best" data-testid="percentile">
              {p.fasterThan(percentileOf(pace))}
            </span>
            <span data-testid="decade">{p.toDecade(one(decade.distance), decade.target)}</span>
          </p>
        ) : (
          <p className="rs-say">
            <span>{p.fewRunsBody(PACE_MIN_RUNS - paceRuns.length)}</span>
          </p>
        )}
      </div>
      {pace !== null ? <p className="pg-def">{p.paceDefinition}</p> : null}
      {languages.length > 1 ? (
        <div className="pg-langs" role="group" aria-label={p.languageSwitch}>
          {languages.map((option) => (
            <button key={option} type="button" className="tp-ctl" aria-pressed={option === language} data-testid={`language-${option}`} onClick={() => setPicked(option)}>
              {s.languageName[option]}
            </button>
          ))}
        </div>
      ) : null}

      <div className="rs-grid">
        <PaceChart runs={paceRuns} now={now} s={s} one={one} longMonth={dates.longMonth} shortMonth={dates.shortMonth} />
        <AccuracyChart rows={rows} s={s} one={one} shortMonth={dates.shortMonth} />
      </div>

      <div className="rs-grid">
        <section className="rs-main" data-testid="calendar">
          <h2 className="rs-title">{p.daysTitle}</h2>
          <p className="rs-finding">{p.daysFinding(calendar.daysInYear, calendar.daysInMonth)}</p>
          <CalendarChart calendar={calendar} s={s} dayLabel={dates.dayLabel} monthLabel={dates.monthOfDay} />
        </section>
        <SlowPairs pairs={pairs && pairs.language === language ? pairs.pairs : []} lang={lang} language={language} s={s} one={one} />
      </div>

      {bests.length > 0 ? (
        <div className="rs-grid">
          <BestsTable
            rows={bests}
            today={today}
            s={s}
            one={one}
            label={(at) => {
              const day = dayFormat.format(at);
              return { day, text: dates.dayLabel(day) };
            }}
          />
          {/* The sign-up banner goes here once accounts exist. Nothing renders until then, so no link leads nowhere. */}
          <div data-slot="account" />
        </div>
      ) : null}
    </div>
  );
}
