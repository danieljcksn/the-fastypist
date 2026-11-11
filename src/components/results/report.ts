import {
  consistency,
  creditTimes,
  curveAt,
  diagnose,
  drillTargets,
  entriesInRun,
  letterPairs,
  type LetterPair,
  mistakes,
  type Mistakes,
  rhythmTier,
  rollover,
  secondSpeeds,
  speedCurve,
  speedFinding,
  type SpeedFinding,
  speedSeries,
  type SpeedPoint,
  wordTimings,
  type Diagnosis,
} from "@/engine/analysis";
import { letterStatus, type LetterStatus } from "@/engine/core";
import { replay } from "@/engine/replay";
import type { RunOutcome } from "@/typing/contract";

export interface MapWord {
  w: number;
  tier: 0 | 1 | 2 | 3;
  text: string;
  /** Only for words with a mistake in them, so a clean 60 s text doesn't cost a span per letter. */
  letters: { ch: string; status: LetterStatus }[] | null;
}

export interface Report {
  consistency: number | null;
  rollover: number | null;
  diagnosis: Diagnosis;
  pairs: LetterPair[];
  targets: string[];
  mistakes: Mistakes;
  map: MapWord[];
  slowestWords: string[];
  /** Net wpm within each second, empty when the run is too short to chart. */
  speeds: number[];
  /** The 5 s window every 250 ms that the chart draws, and its value at the middle of each second. */
  curve: { ms: number; wpm: number }[];
  line: number[];
  errors: number[];
  finding: SpeedFinding | null;
}

// Under these the map and the chart have no shape to read: a few words, or a line that is all moving average.
const MAP_MIN_WORDS = 5;
const CHART_MIN_SECONDS = 5;
const SLOWEST_IN_LABEL = 3;

function mapOf(outcome: RunOutcome): { map: MapWord[]; slowestWords: string[] } {
  const { config, words, entries, score } = outcome;
  const { state } = replay(config, words, entries);
  const timings = wordTimings(config, words, entries);
  if (score.wpm <= 0 || timings.filter((t) => t.committed).length < MAP_MIN_WORDS) return { map: [], slowestWords: [] };
  const map: MapWord[] = [];
  for (const timing of timings) {
    const target = words[timing.w] ?? "";
    const typed = state.typed[timing.w] ?? "";
    const length = timing.committed ? Math.max(target.length, typed.length) : typed.length;
    if (length === 0) continue;
    const letters: { ch: string; status: LetterStatus }[] = [];
    let clean = true;
    for (let i = 0; i < length; i++) {
      const status = letterStatus(words, state, timing.w, i);
      if (status === "wrong" || status === "extra" || status === "missed") clean = false;
      letters.push({ ch: i < target.length ? target.charAt(i) : typed.charAt(i), status });
    }
    map.push({
      w: timing.w,
      tier: rhythmTier(timing.wpm, score.wpm),
      text: target.slice(0, Math.min(length, target.length)),
      letters: clean ? null : letters,
    });
  }
  const slowestWords = timings
    .filter((t) => t.committed)
    .sort((a, b) => a.wpm - b.wpm)
    .slice(0, SLOWEST_IN_LABEL)
    .map((t) => words[t.w] ?? "");
  return { map, slowestWords };
}

/** secondSpeeds can fold a last sliver into the second before it, and its mistakes go with it. */
function errorsPer(series: readonly SpeedPoint[], seconds: number): number[] {
  const out = series.slice(0, seconds).map((p) => p.errors);
  for (const p of series.slice(seconds)) out[seconds - 1] = (out[seconds - 1] ?? 0) + p.errors;
  return out;
}

export function reportOf(outcome: RunOutcome): Report {
  const { config, words, entries, score } = outcome;
  const inRun = entriesInRun(config, words, entries);
  const series = score.elapsedMs >= CHART_MIN_SECONDS * 1000 ? speedSeries(config, words, entries) : [];
  const speeds = secondSpeeds(series, score.elapsedMs);
  const curve = speeds.length > 0 ? speedCurve(creditTimes(config, words, entries), score.elapsedMs) : [];
  // Each second read at its middle, where the chart centres it. The last may be long or short, so its middle is its own.
  const line = speeds.map((_, i) => curveAt(curve, i === speeds.length - 1 ? (i * 1000 + score.elapsedMs) / 2 : i * 1000 + 500));
  return {
    consistency: consistency(inRun),
    rollover: rollover(inRun),
    diagnosis: diagnose(config, words, entries),
    pairs: letterPairs(config, words, entries),
    targets: drillTargets(config, words, entries),
    mistakes: mistakes(config, words, entries),
    ...mapOf(outcome),
    speeds,
    curve,
    line,
    errors: errorsPer(series, speeds.length),
    // speedFinding wants 20 s or more, which is where the chart starts smoothing too, so both read the same line.
    finding: speedFinding(line),
  };
}
