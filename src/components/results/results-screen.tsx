"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PairBars } from "@/components/charts/pair-bars";
import { SpeedChart } from "@/components/charts/speed-chart";
import { ResultHero } from "@/components/typing/result-fallback";
import { drillChange, type PairBaseline, type PairChange, RHYTHM_CUTS } from "@/engine/analysis";
import type { Lang } from "@/i18n";
import { formatter, type ReportStrings, reportStrings } from "@/i18n/report";
import type { RunOutcome } from "@/typing/contract";
import { planDrill } from "@/typing/history/drill";
import { recordRun } from "@/typing/history/record";
import type { HomeStore } from "@/typing/store";
import { type MapWord, type Report, reportOf } from "./report";
import { RunVerdict } from "./run-verdict";
import "@/components/charts/report.css";

const TIER_CLASS = ["r1", "r3", "r4", "r5"] as const;
const LETTER_CLASS = { wrong: "lw", extra: "lx", missed: "lm" } as const;

// Pairs of two or three samples are noise as a ranked list, even where they are enough to pick a drill.
const PAIR_ROWS = 3;
const PAIR_ROW_MIN_COUNT = 3;
const PAIR_ROW_MIN_COST = 0.05;

function MapText({ word }: { word: MapWord }) {
  if (word.letters === null) return <span className={TIER_CLASS[word.tier]}>{word.text}</span>;
  return (
    <span className={TIER_CLASS[word.tier]}>
      {word.letters.map((letter, i) => {
        const mark = letter.status === "wrong" || letter.status === "extra" || letter.status === "missed" ? LETTER_CLASS[letter.status] : undefined;
        return (
          <span key={i} className={mark}>
            {letter.ch}
          </span>
        );
      })}
    </span>
  );
}

function RhythmMap({ report, runWpm, s }: { report: Report; runWpm: number; s: ReportStrings }) {
  const cuts = RHYTHM_CUTS.map((share) => Math.round(share * runWpm));
  return (
    <section>
      <header className="cx-title">
        <h2 className="rs-title">{s.mapTitle}</h2>
        <div className="cx-legend" aria-hidden="true">
          {[`${cuts[0]}+`, `${cuts[1]}+`, `${cuts[2]}+`, s.under(cuts[2] ?? 0)].map((text, i) => (
            <span key={text}>
              <i className="cx-key-swatch" style={{ background: `var(--r-${[1, 3, 4, 5][i]})` }} />
              {text}
            </span>
          ))}
          <span>{s.wpm}</span>
        </div>
      </header>
      <p className="rs-map" translate="no" role="img" aria-label={s.mapLabel(report.slowestWords)}>
        {report.map.map((word, i) => (
          <span key={word.w}>
            {i > 0 ? " " : null}
            <MapText word={word} />
          </span>
        ))}
      </p>
    </section>
  );
}

function MistakeRows({ report, s }: { report: Report; s: ReportStrings }) {
  const { wrong, extra, missed } = report.mistakes;
  const total = wrong + extra + missed;
  return (
    <section>
      <h2 className="rs-title">{s.mistakesTitle(total)}</h2>
      {total > 0 ? (
        <dl className="rs-rows">
          <dt>
            <span className="rs-spec lw">{s.wrong}</span>
          </dt>
          <dd>{wrong}</dd>
          <dt>
            <span className="rs-spec lx">{s.extra}</span>
          </dt>
          <dd>{extra}</dd>
          <dt>
            <span className="rs-spec lm">{s.missed}</span>
          </dt>
          <dd>{missed}</dd>
        </dl>
      ) : null}
    </section>
  );
}

function DrillTable({ changes, s }: { changes: readonly PairChange[]; s: ReportStrings }) {
  const whole = (ms: number | null) => (ms === null || ms === 0 ? "" : s.ms(String(Math.round(ms))));
  return (
    <section className="rs-drilled">
      <h2 className="rs-title">{s.drillTitle}</h2>
      <table className="rs-table" data-testid="drill-table">
        <thead>
          <tr>
            <th scope="col">{s.pair}</th>
            <th scope="col">{s.drillBefore}</th>
            <th scope="col">{s.drillNow}</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((c) => (
            <tr key={c.pair} data-verdict={c.verdict}>
              <td className="rs-pair" translate="no">
                {c.pair}
              </td>
              <td>{whole(c.beforeMs)}</td>
              <td>{whole(c.nowMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function SlowPairs({ report, s, format }: { report: Report; s: ReportStrings; format: (n: number) => string }) {
  const rows = report.pairs.filter((p) => p.count >= PAIR_ROW_MIN_COUNT && p.costWpm >= PAIR_ROW_MIN_COST).slice(0, PAIR_ROWS);
  const top = rows[0]?.costWpm ?? 0;
  if (rows.length === 0) return null;
  return (
    <section>
      <h2 className="rs-title">{s.slowestPairs}</h2>
      <PairBars rows={rows.map((p) => ({ pair: p.pair, share: p.costWpm / top, cost: `${format(p.costWpm)} ${s.wpm}` }))} />
    </section>
  );
}

function modeWords(outcome: RunOutcome, s: ReportStrings): string {
  if (outcome.drill) return s.mode.drill(outcome.drill.pairs);
  const language = s.languageName[outcome.language];
  switch (outcome.mode.kind) {
    case "time":
      return s.mode.time(outcome.mode.seconds, language);
    case "words":
      return s.mode.words(outcome.mode.count, language);
    case "quote":
      return s.mode.quote(language);
    case "custom":
      return s.mode.custom;
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CopySummary({ text, s, onDone }: { text: string; s: ReportStrings; onDone(pointer: boolean): void }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <button
      type="button"
      className="tp-ctl rs-copy"
      data-testid="copy-summary"
      onClick={(e) => {
        const pointer = e.detail > 0;
        void copyText(text).then((ok) => {
          setState(ok ? "copied" : "failed");
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setState("idle"), 2_000);
          onDone(pointer);
        });
      }}
    >
      <span aria-live="polite">{state === "copied" ? s.copied : state === "failed" ? s.copyFailed : s.copySummary}</span>
    </button>
  );
}

function bestLine(run: ReturnType<typeof recordRun>, s: ReportStrings, format: (n: number) => string): string | null {
  if (run.previous === null) return null;
  const diffCx = run.row.wpmCx - run.previous.wpmCx;
  // Rounded once, on integers: a gap of 143.95 is 143.94999… as a double, and formatting that rounds down.
  const shown = format(Math.round(Math.abs(diffCx) / 10) / 10);
  const zero = format(0);
  if (shown === zero) return s.bestChange(shown, 0);
  return s.bestChange(shown, diffCx > 0 ? 1 : -1);
}

export default function ResultsScreen({ outcome, lang, store }: { outcome: RunOutcome; lang: Lang; store: HomeStore }) {
  const s = reportStrings(lang);
  const report = useMemo(() => reportOf(outcome), [outcome]);
  const recorded = useMemo(() => recordRun(outcome), [outcome]);
  const one = useMemo(() => formatter(s.locale, 1), [s.locale]);
  const { score } = outcome;
  const accuracy = `${one(score.accuracy)}%`;

  const changes = useMemo(() => (outcome.drill ? drillChange(outcome.drill.before, report.pairs) : null), [outcome, report]);
  const best = changes ? null : bestLine(recorded, s, one);
  const measured = changes ? s.drillFinding(changes, (n) => String(Math.round(n))) : null;
  const diagnosis = changes ? measured : s.diagnosis(report.diagnosis, outcome.id);
  const keys = score.correctKeys + score.wrongKeys;
  const zeroLine = score.wpmCx === 0 && keys > 0 ? (score.correctKeys === 0 ? s.allWrongLetters : s.allWrongWords) : null;
  const say = diagnosis ?? zeroLine;

  const newWords = () => store.session?.newWords();
  const [noWords, setNoWords] = useState(false);
  const targets = report.targets;

  // A guard, so a second Enter while the list loads can't start two drills.
  const starting = useRef(false);
  const primary = useMemo<(() => void) | null>(() => {
    if (outcome.drill) return () => store.session?.again();
    if (targets.length === 0) return null;
    return () => {
      if (starting.current) return;
      starting.current = true;
      const before: Record<string, PairBaseline> = {};
      for (const pair of targets) {
        const found = report.pairs.find((p) => p.pair.toLowerCase() === pair);
        before[pair] = { meanMs: found?.meanMs ?? 0, count: found?.count ?? 0 };
      }
      void planDrill(outcome.language, outcome.accentFree, targets, before).then((plan) => {
        starting.current = false;
        if (plan) store.setDrill(plan);
        else setNoWords(true);
      });
    };
  }, [outcome, report, targets, store]);

  useEffect(() => {
    store.setPrimary(primary ?? (() => store.session?.newWords()));
    return () => store.setPrimary(null);
  }, [store, primary]);

  const primaryLabel = outcome.drill ? s.drillAgain : targets.length > 0 ? s.drill(targets) : null;

  const refocus = (pointer: boolean) => {
    if (pointer) store.session?.focusInput();
  };

  return (
    <section className="rs" data-testid="result" data-wpm-cx={score.wpmCx} data-device={outcome.deviceClass}>
      <div className="rs-top">
        <ResultHero wpm={score.wpm} unit={s.wpm} />
        <dl className="rs-stats">
          <dt>{s.accuracy}</dt>
          <dd data-stat="accuracy">{accuracy}</dd>
          <dt>{s.raw}</dt>
          <dd data-stat="raw">{Math.round(score.rawWpm)}</dd>
          {report.consistency !== null ? (
            <>
              <dt>{s.consistency}</dt>
              <dd data-stat="consistency">{Math.round(report.consistency)}%</dd>
            </>
          ) : null}
          {report.rollover !== null ? (
            <>
              <dt>{s.rollover}</dt>
              <dd data-stat="rollover">{Math.round(report.rollover * 100)}%</dd>
            </>
          ) : null}
        </dl>
        {best || say || noWords || outcome.flight ? (
          <p className="rs-say">
            {best ? (
              <span className="rs-best" data-testid="best-line">
                {best}
              </span>
            ) : null}
            {say ? <span data-testid="diagnosis">{say}</span> : null}
            {noWords ? <span>{s.noDrillWords}</span> : null}
            {outcome.flight ? <RunVerdict id={outcome.id} lang={lang} store={store} /> : null}
          </p>
        ) : null}
        <div className="rs-actions">
          {primaryLabel ? (
            <button type="button" className="rs-btn rs-primary" data-testid="primary-action" onClick={() => primary?.()}>
              <span translate="no">{primaryLabel}</span> <kbd>{s.enterKey}</kbd>
            </button>
          ) : null}
          <button type="button" className={primaryLabel ? "rs-btn" : "rs-btn rs-primary"} data-testid="new-words" onClick={newWords}>
            {s.newWords} <kbd>{s.tabKey}</kbd>
          </button>
        </div>
        <div className="rs-share">
          <CopySummary text={s.summary(String(Math.round(score.wpm)), accuracy, modeWords(outcome, s))} s={s} onDone={refocus} />
        </div>
      </div>

      {report.map.length > 0 || report.mistakes.at.length > 0 || report.pairs.length > 0 ? (
        <div className="rs-grid">
          <div className="rs-main">
            {changes ? <DrillTable changes={changes} s={s} /> : null}
            {report.map.length > 0 ? <RhythmMap report={report} runWpm={score.wpm} s={s} /> : null}
          </div>
          <aside className="rs-side">
            <MistakeRows report={report} s={s} />
            <SlowPairs report={report} s={s} format={one} />
          </aside>
        </div>
      ) : null}

      {report.speeds.length > 0 ? (
        <SpeedChart
          revealKey={`speed:${outcome.id}`}
          s={s}
          data={{ speeds: report.speeds, curve: report.curve, line: report.line, errors: report.errors, mistakesMs: report.mistakes.at, elapsedMs: score.elapsedMs, finding: report.finding ? s.speedFinding(report.finding) : null }}
        />
      ) : null}
    </section>
  );
}
