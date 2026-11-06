import { consistency, entriesInRun } from "@/engine/analysis";
import { encodeLog } from "@/engine/log";
import type { RunOutcome } from "../contract";
import { type HistoryRow } from "./rows";
import { putRaw } from "./raw";
import { type Appended, appendRow, loadHistory } from "./summaries";

export interface RecordedRun extends Appended {
  row: HistoryRow;
}

// Only the latest few matter: a result screen asks for its own run, and the session asks for the same one a frame later.
const REMEMBERED = 4;
const recorded = new Map<string, RecordedRun>();

function modsOf(outcome: RunOutcome): string {
  if (outcome.drill) return "";
  return `${outcome.punctuation ? "p" : ""}${outcome.numbers ? "n" : ""}${outcome.accentFree && outcome.language === "pt" ? "a" : ""}`;
}

function amountOf(outcome: RunOutcome): number {
  if (outcome.mode.kind === "time") return outcome.mode.seconds;
  return outcome.wordsCount;
}

export function rowOf(outcome: RunOutcome): HistoryRow {
  const { score } = outcome;
  const value = consistency(entriesInRun(outcome.config, outcome.words, outcome.entries));
  return {
    id: outcome.id,
    kind: outcome.drill ? "drill" : "free",
    status: "unverified",
    mode: outcome.drill ? "words" : outcome.mode.kind,
    amount: amountOf(outcome),
    language: outcome.language,
    pack: outcome.packId,
    mods: modsOf(outcome),
    wpmCx: score.wpmCx,
    rawCx: score.rawCx,
    accuracyBp: score.accuracyBp,
    consistencyBp: value === null ? null : Math.round(value * 100),
    elapsedMs: score.elapsedMs,
    afkMs: outcome.afkMs,
    finishedAt: outcome.finishedAt,
    localDay: outcome.localDay,
    device: outcome.deviceClass,
  };
}

function keepRaw(outcome: RunOutcome, row: HistoryRow) {
  try {
    // Holds are checked once at a ranked submit and never stored, here included.
    const log = encodeLog(
      outcome.entries.map((entry) => {
        const copy = { ...entry };
        delete copy.h;
        return copy;
      }),
    );
    const keep = new Set(Object.values(loadHistory().bests).map((best) => best.id));
    void putRaw({ v: 1, id: row.id, finishedAt: row.finishedAt, language: row.language, drill: outcome.drill !== null, cfg: outcome.config, words: outcome.words, log }, keep);
  } catch {
    // A log the format can't hold is a capture bug the replay tests catch. It must not cost the typist their result.
  }
}

/** Idempotent per run. The result screen needs the answer while rendering, and the session must save it even if that screen never loads. */
export function recordRun(outcome: RunOutcome): RecordedRun {
  const known = recorded.get(outcome.id);
  if (known) return known;
  const row = rowOf(outcome);
  const out: RecordedRun = { row, ...appendRow(row) };
  recorded.set(outcome.id, out);
  if (recorded.size > REMEMBERED) {
    const oldest = recorded.keys().next().value;
    if (oldest !== undefined) recorded.delete(oldest);
  }
  keepRaw(outcome, row);
  return out;
}
