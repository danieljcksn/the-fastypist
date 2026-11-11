"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AccuracyChart } from "@/components/charts/accuracy-chart";
import { CalendarChart } from "@/components/charts/calendar-chart";
import { PaceChart } from "@/components/charts/pace-chart";
import { PairBars } from "@/components/charts/pair-bars";
import { heroBearing } from "@/components/typing/result-fallback";
import { currentPace, type LetterPair, monthInsight, nextDecade, PACE_MIN_RUNS, paceSeries, paceTrend, pairsAcrossRuns, percentileOf, type TimedRun } from "@/engine/analysis";
import { decodeLog } from "@/engine/log";
import type { Language } from "@/engine/packs";
import { href, type Lang } from "@/i18n";
import { formatter, type ReportStrings, reportStrings } from "@/i18n/report";
import { allRaw } from "@/typing/history/raw";
import { countsForPace } from "@/typing/history/rows";
import { EMPTY_HISTORY, loadHistory, subscribeHistory } from "@/typing/history/summaries";
import { type BestRow, bestRows, calendarOf, languagesOf, recentAccuracy, timeTypedMs, weeklyAccuracy } from "./model";
import "@/components/charts/report.css";

const PAIR_ROWS = 5;
const DRILL_PAIRS = 3;

function dateParts(locale: string) {
  const part = (options: Intl.DateTimeFormatOptions) => {
    const format = new Intl.DateTimeFormat(locale, options);
    return (t: number) => format.format(t).replace(/\./g, "");
  };
  const month = { local: part({ month: "short" }), utc: part({ month: "short", timeZone: "UTC" }) };
  const weekday = { local: part({ weekday: "short" }), utc: part({ weekday: "short", timeZone: "UTC" }) };
  const date = { local: (t: number) => new Date(t).getDate(), utc: (t: number) => new Date(t).getUTCDate() };
  // "Tue 4 Nov" in English and "ter 4 nov" in Portuguese, built by hand: Intl orders an English day and month "Nov 4".
  const full = (zone: "local" | "utc", t: number) => {
    const text = `${weekday[zone](t)} ${date[zone](t)} ${month[zone](t)}`;
    return locale === "en" ? text : text.toLowerCase();
  };
  const long = new Intl.DateTimeFormat(locale, { month: "long" });
  const utcOf = (day: string) => Date.parse(`${day}T12:00:00Z`);
  return {
    dayLabel: (day: string) => `${date.utc(utcOf(day))} ${month.utc(utcOf(day)).toLowerCase()}`,
    /** January rather than jan, for a sentence. English capitalises it and Portuguese does not, and Intl knows. */
    longMonth: (t: number) => long.format(t),
    pace: {
      day: (t: number) => full("local", t),
      month: (t: number) => month.local(t).toLowerCase(),
      dayStart: (t: number) => new Date(t).setHours(0, 0, 0, 0),
    },
    accuracy: {
      // "2 Aug", in the same case as "Sun 9 Aug" beside it.
      short: (t: number) => (locale === "en" ? `${date.utc(t)} ${month.utc(t)}` : `${date.utc(t)} ${month.utc(t)}`.toLowerCase()),
      month: (t: number) => month.utc(t).toLowerCase(),
      day: (t: number) => full("local", t),
    },
    calendar: {
      day: (day: string) => full("utc", utcOf(day)),
      month: (day: string) => month.utc(utcOf(day)).toLowerCase(),
    },
  };
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
      {finding ? <p className="cx-finding">{finding}</p> : null}
      <PairBars rows={rows.map((pair) => ({ pair: pair.pair, share: pair.costWpm / top.costWpm, extra: s.ms(String(Math.round(pair.meanMs))), cost: `${one(pair.costWpm)} ${s.wpm}` }))} />
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
  const weeks = useMemo(() => weeklyAccuracy(rows), [rows]);
  const accuracyRuns = useMemo(() => rows.filter((row) => row.kind === "free").map((row) => ({ t: row.finishedAt, accuracy: row.accuracyBp / 100 })), [rows]);
  const series = useMemo(() => paceSeries(paceRuns), [paceRuns]);
  const trend = useMemo(() => paceTrend(series), [series]);
  const insight = useMemo(() => monthInsight(paceRuns, now), [paceRuns, now]);
  let paceFinding: string | null = null;
  if (insight) paceFinding = p.insight(insight, insight.kind === "same" ? "" : one(insight.wpm));
  else if (trend) paceFinding = p.trend(one(Math.abs(trend.wpm)), trend.wpm > 0, dates.longMonth(trend.since));

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

      <div className="rs-grid cx-row">
        {paceRuns.length > 0 ? <PaceChart runs={paceRuns} now={now} finding={paceFinding} s={s} one={one} dates={dates.pace} revealKey={`pace:${language}`} /> : <div />}
        {accuracyRuns.length > 0 ? <AccuracyChart weeks={weeks} runs={accuracyRuns} s={s} one={one} dates={dates.accuracy} revealKey={`accuracy:${language}`} /> : <div />}
      </div>

      <div className="rs-grid">
        <section className="rs-main" data-testid="calendar">
          <h2 className="rs-title">{p.daysTitle}</h2>
          <p className="cx-finding">{p.daysFinding(calendar.daysInYear, calendar.daysInMonth)}</p>
          <CalendarChart calendar={calendar} s={s} dates={dates.calendar} revealKey={`days:${language}`} />
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
