import { type Config, type LogEntry, type State, WORDS_MAX_ELAPSED_MS, expire, expiresAt, init, insertions, step } from './core';
import { streamFromHex, xoshiro128pp } from './prng';
import { creditedChars, rawCx, score, wpmCx } from './score';

// Display analytics only. Nothing here feeds rank, so Math.exp and friends are allowed; the frozen modules never import this file.

const STREAM_DRILL = 3;

const CONSISTENCY_WINDOW = 20;
const CONSISTENCY_MIN_WINDOWS = 5;

const ROLLOVER_MIN_PAIRS = 20;

// Above this a gap is a pause, and a pause says nothing about the letters on either side of it.
const PAUSE_MS = 2_000;

// All of these thresholds are choices with no data behind them yet. Err towards saying nothing.
const DIAGNOSE_MIN_KEYS = 100;
const DIAGNOSE_MIN_COST_WPM = 1;
const DIAGNOSE_MAX_ITEMS = 3;
const SLOW_PAIR_MIN_COUNT = 5;
const SLOW_PAIR_MIN_RATIO = 1.25;
const ERROR_LETTER_MIN_ATTEMPTS = 10;
const ERROR_LETTER_MIN_ERRORS = 3;
const ERROR_LETTER_MIN_RATE = 0.1;
const ERROR_LETTER_MIN_LIFT = 2;
const HESITATION_LONG_WORD = 7;
const HESITATION_SHORT_WORD = 4;
const HESITATION_MIN_COUNT = 5;
const HESITATION_MIN_RATIO = 1.5;
const HESITATION_MIN_GAP_MS = 80;
const CORRECTION_MIN_COUNT = 10;
const CORRECTION_MIN_RATE = 0.08;

// A corrected key is roughly two more presses: the backspace and the retype.
const PRESSES_PER_CORRECTION = 2;

const REDRAWS = 16;
const DRILL_NO_REPEAT = 3;

// Normal(51.56, 20.2), from the summary published by Dhakal et al. 2018. It gives 10.3% at their P10 of 26 and 90.5% at
// their P90 of 78. Never replace this with a table derived from their per-user data: that licence is non-commercial.

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid] ?? 0;
  return sorted.length % 2 === 1 ? hi : ((sorted[mid - 1] ?? 0) + hi) / 2;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** WPM gained if savedMs had not been spent, holding the credited characters fixed. */
function costWpm(netWpm: number, elapsedMs: number, savedMs: number): number {
  if (netWpm <= 0 || elapsedMs <= 0 || savedMs <= 0) return 0;
  // A choice: no one finding claims more than doubling the speed. Past that the model divides by almost nothing.
  const saved = Math.min(savedMs, elapsedMs / 2);
  return round2((netWpm * elapsedMs) / (elapsedMs - saved) - netWpm);
}

/** The keys that belong to the run, from the one that started the clock to the finish. consistency and rollover take this, never the raw log. */
export function entriesInRun(cfg: Config, words: readonly string[], entries: readonly LogEntry[]): LogEntry[] {
  const s = init();
  const out: LogEntry[] = [];
  for (const e of entries) {
    if (s.phase === 'finished' || e.t >= expiresAt(cfg, s)) break;
    step(cfg, words, s, e);
    if (s.phase !== 'idle') out.push(e);
  }
  return out;
}

/** 100·e^(−cv) of speed over non-overlapping windows that share their boundary keys, so no gap goes uncounted. */
export function consistency(entries: readonly LogEntry[]): number | null {
  const speeds: number[] = [];
  for (let a = 0; a + CONSISTENCY_WINDOW < entries.length; a += CONSISTENCY_WINDOW) {
    const from = entries[a];
    const to = entries[a + CONSISTENCY_WINDOW];
    if (from === undefined || to === undefined) continue;
    const ms = to.t - from.t;
    if (ms > 0) speeds.push(CONSISTENCY_WINDOW / ms);
  }
  if (speeds.length < CONSISTENCY_MIN_WINDOWS) return null;
  let sum = 0;
  for (const v of speeds) sum += v;
  const mean = sum / speeds.length;
  let squares = 0;
  for (const v of speeds) squares += (v - mean) * (v - mean);
  return 100 * Math.exp(-Math.sqrt(squares / speeds.length) / mean);
}

export interface SpeedPoint {
  second: number;
  raw: number;
  net: number;
  errors: number;
}

/** Per scoring.md: raw and errors per bucket (i−1, i], net cumulative up to i. The last point's net is the run's score. */
export function speedSeries(cfg: Config, words: readonly string[], entries: readonly LogEntry[]): SpeedPoint[] {
  const final = init();
  for (const e of entries) step(cfg, words, final, e);
  if (final.phase === 'idle') return [];
  expire(cfg, final);
  // T must be known first: an ignored key after the last real one moves no clock, so it may not open a new bucket.
  const elapsedMs = score(cfg, words, final).elapsedMs;
  // One point per second of claimed time, so a forged log of two keys 2^31 ms apart would cost two million points.
  if (elapsedMs > WORDS_MAX_ELAPSED_MS) return [];

  const s = init();
  const out: SpeedPoint[] = [];
  let second = 1;
  let keysBefore = 0;
  let errorsBefore = 0;
  const flush = (bucketMs: number, upToMs: number): void => {
    const keys = insertions(s);
    out.push({
      second,
      raw: rawCx(keys - keysBefore, bucketMs) / 100,
      net: wpmCx(creditedChars(cfg, words, s), upToMs) / 100,
      errors: s.wrongKeys - errorsBefore,
    });
    keysBefore = keys;
    errorsBefore = s.wrongKeys;
    second++;
  };
  for (const e of entries) {
    if (s.phase === 'running') {
      while (second * 1000 < elapsedMs && second * 1000 < e.t - s.startT) flush(1000, second * 1000);
    }
    step(cfg, words, s, e);
  }
  expire(cfg, s);
  while (second * 1000 < elapsedMs) flush(1000, second * 1000);
  const remainder = elapsedMs - (second - 1) * 1000;
  if (remainder > 0) flush(remainder, elapsedMs);
  return out;
}

export interface WordTiming {
  w: number;
  ms: number;
  wpm: number;
  correct: boolean;
  committed: boolean;
}

/** Commit to commit, so the pause before a word counts as that word's and the times sum to the run. */
export function wordTimings(cfg: Config, words: readonly string[], entries: readonly LogEntry[]): WordTiming[] {
  const s = init();
  const commits: number[] = [];
  for (const e of entries) {
    const change = step(cfg, words, s, e);
    if (change.c === 'commit') commits[change.w] = e.t;
    // Returning to a wrong word reopens its interval.
    if (s.w < commits.length && !s.allCommitted) commits.length = s.w;
  }
  if (s.phase === 'idle') return [];
  expire(cfg, s);
  const end = s.phase === 'finished' ? s.endT : s.lastT;
  const last = words.length - 1;
  const out: WordTiming[] = [];
  for (let w = 0; w <= s.w; w++) {
    const target = words[w] ?? '';
    const typed = s.typed[w] ?? '';
    const committed = w < s.w || s.allCommitted;
    const from = w === 0 ? s.startT : (commits[w - 1] ?? s.startT);
    const to = w < s.w ? (commits[w] ?? end) : end;
    const ms = to - from;
    const chars = committed ? (w < last ? target.length + 1 : target.length) : typed.length;
    out.push({ w, ms, wpm: rawCx(chars, ms) / 100, correct: typed === target, committed });
  }
  return out;
}

export interface ErrorBreakdown {
  substitution: number;
  omission: number;
  insertion: number;
  transposition: number;
  wrongWords: number;
}

// Optimal string alignment: adjacent swaps count once, and a swap is not edited again, which suits typing errors.
function alignInto(out: ErrorBreakdown, target: string, typed: string): void {
  const rows = target.length + 1;
  const cols = typed.length + 1;
  const d = new Int32Array(rows * cols);
  const at = (i: number, j: number): number => d[i * cols + j] ?? 0;
  for (let i = 0; i < rows; i++) d[i * cols] = i;
  for (let j = 0; j < cols; j++) d[j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const same = target.charCodeAt(i - 1) === typed.charCodeAt(j - 1);
      let best = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + (same ? 0 : 1));
      if (i > 1 && j > 1 && target.charCodeAt(i - 1) === typed.charCodeAt(j - 2) && target.charCodeAt(i - 2) === typed.charCodeAt(j - 1)) {
        best = Math.min(best, at(i - 2, j - 2) + 1);
      }
      d[i * cols + j] = best;
    }
  }
  let i = target.length;
  let j = typed.length;
  while (i > 0 || j > 0) {
    const here = at(i, j);
    if (i > 0 && j > 0 && target.charCodeAt(i - 1) === typed.charCodeAt(j - 1) && here === at(i - 1, j - 1)) {
      i--;
      j--;
    } else if (
      i > 1 && j > 1 &&
      target.charCodeAt(i - 1) === typed.charCodeAt(j - 2) &&
      target.charCodeAt(i - 2) === typed.charCodeAt(j - 1) &&
      here === at(i - 2, j - 2) + 1
    ) {
      out.transposition++;
      i -= 2;
      j -= 2;
    } else if (i > 0 && j > 0 && here === at(i - 1, j - 1) + 1) {
      out.substitution++;
      i--;
      j--;
    } else if (j > 0 && here === at(i, j - 1) + 1) {
      out.insertion++;
      j--;
    } else {
      out.omission++;
      i--;
    }
  }
}

export function errorBreakdown(words: readonly string[], s: State): ErrorBreakdown {
  const out: ErrorBreakdown = { substitution: 0, omission: 0, insertion: 0, transposition: 0, wrongWords: 0 };
  for (let w = 0; w <= s.w; w++) {
    const target = words[w];
    const typed = s.typed[w];
    if (target === undefined || typed === undefined) continue;
    // Letters the clock cut off were never reached, so they are not omissions.
    const expected = w < s.w || s.allCommitted ? target : target.slice(0, typed.length);
    if (typed === expected) continue;
    out.wrongWords++;
    alignInto(out, expected, typed);
  }
  return out;
}

/** The fraction of key pairs where the next keydown came before the previous keyup. */
export function rollover(entries: readonly LogEntry[]): number | null {
  const pairs = entries.length - 1;
  let held = 0;
  let rolled = 0;
  for (let i = 0; i < pairs; i++) {
    const a = entries[i];
    const b = entries[i + 1];
    if (a === undefined || b === undefined || a.h === undefined) continue;
    held++;
    if (b.t < a.t + a.h) rolled++;
  }
  if (held < ROLLOVER_MIN_PAIRS || held * 2 < pairs) return null;
  return rolled / held;
}

export interface LetterPair {
  pair: string;
  count: number;
  meanMs: number;
  costWpm: number;
}

interface RunFacts {
  netWpm: number;
  elapsedMs: number;
  keys: number;
  corrections: number;
  medianGapMs: number;
  medianPairMs: number;
  pairs: Map<string, { sum: number; count: number }>;
  letters: Map<string, { attempts: number; errors: number }>;
  wrongRate: number;
  starts: { len: number; ms: number }[];
}

function collect(cfg: Config, words: readonly string[], entries: readonly LogEntry[]): RunFacts {
  const s = init();
  const pairs = new Map<string, { sum: number; count: number }>();
  const letters = new Map<string, { attempts: number; errors: number }>();
  const pairLatencies: number[] = [];
  const gaps: number[] = [];
  const starts: { len: number; ms: number }[] = [];
  // Reset by every other op. A dead key between two letters is two presses, so that latency is not a pair's: "nã" would
  // read as slow on ABNT2 for a reason practice cannot fix.
  let prevLetter: { w: number; i: number; t: number } | null = null;
  let prevCommitT: number | null = null;
  let prevT: number | null = null;
  for (const e of entries) {
    if (s.phase === 'finished' || e.t >= expiresAt(cfg, s)) break;
    const w = s.w;
    const target = words[w] ?? '';
    const slot = (s.typed[w] ?? '').length;
    const keysBefore = insertions(s);
    const change = step(cfg, words, s, e);
    if (s.phase !== 'idle') {
      if (prevT !== null) gaps.push(e.t - prevT);
      prevT = e.t;
    }
    if (e.k === 'c' && slot < target.length && insertions(s) > keysBefore) {
      const letter = target.charAt(slot);
      const entry = letters.get(letter) ?? { attempts: 0, errors: 0 };
      entry.attempts++;
      if (e.ch !== letter) entry.errors++;
      letters.set(letter, entry);
    }
    if (change.c === 'letter' && change.ok && !change.extra) {
      if (prevLetter !== null && prevLetter.w === change.w && prevLetter.i === change.i - 1) {
        const ms = e.t - prevLetter.t;
        if (ms <= PAUSE_MS) {
          const key = target.slice(change.i - 1, change.i + 1);
          const entry = pairs.get(key) ?? { sum: 0, count: 0 };
          entry.sum += ms;
          entry.count++;
          pairs.set(key, entry);
          pairLatencies.push(ms);
        }
      }
      prevLetter = { w: change.w, i: change.i, t: e.t };
    } else {
      prevLetter = null;
    }
    if (change.c === 'letter' && change.i === 0 && prevCommitT !== null) {
      const ms = e.t - prevCommitT;
      if (ms <= PAUSE_MS) starts.push({ len: target.length, ms });
    }
    prevCommitT = change.c === 'commit' ? e.t : null;
  }
  expire(cfg, s);
  const result = score(cfg, words, s);
  const keys = insertions(s);
  return {
    netWpm: result.wpm,
    elapsedMs: result.elapsedMs,
    keys,
    corrections: s.backspaces,
    medianGapMs: median(gaps),
    medianPairMs: median(pairLatencies),
    pairs,
    letters,
    wrongRate: keys > 0 ? s.wrongKeys / keys : 0,
    starts,
  };
}

function pairsFrom(facts: RunFacts): LetterPair[] {
  const out: LetterPair[] = [];
  for (const [pair, { sum, count }] of facts.pairs) {
    const meanMs = sum / count;
    const saved = count * (meanMs - facts.medianPairMs);
    out.push({ pair, count, meanMs: round2(meanMs), costWpm: costWpm(facts.netWpm, facts.elapsedMs, saved) });
  }
  return out.sort((a, b) => b.costWpm - a.costWpm || (a.pair < b.pair ? -1 : a.pair > b.pair ? 1 : 0));
}

/** Correctly typed adjacent pairs inside words, worst first. Each pair's cost is what closing its gap to the run's median would add. */
export function letterPairs(cfg: Config, words: readonly string[], entries: readonly LogEntry[]): LetterPair[] {
  return pairsFrom(collect(cfg, words, entries));
}

export type Diagnosis =
  | { kind: 'slow-pairs'; pairs: string[]; costWpm: number }
  | { kind: 'error-prone-letters'; letters: string[]; costWpm: number }
  | { kind: 'hesitation-before-long-words'; gapMs: number; costWpm: number }
  | { kind: 'too-much-correction'; corrections: number; costWpm: number }
  | { kind: 'nothing-notable'; costWpm: 0 };

function slowPairsFinding(facts: RunFacts): Diagnosis | null {
  const slow = pairsFrom(facts)
    .filter((p) => p.count >= SLOW_PAIR_MIN_COUNT && p.meanMs >= facts.medianPairMs * SLOW_PAIR_MIN_RATIO && p.costWpm > 0)
    .slice(0, DIAGNOSE_MAX_ITEMS);
  if (slow.length === 0) return null;
  let saved = 0;
  for (const p of slow) saved += p.count * (p.meanMs - facts.medianPairMs);
  return { kind: 'slow-pairs', pairs: slow.map((p) => p.pair), costWpm: costWpm(facts.netWpm, facts.elapsedMs, saved) };
}

function errorLettersFinding(facts: RunFacts): Diagnosis | null {
  const bad: { letter: string; errors: number; rate: number }[] = [];
  for (const [letter, { attempts, errors }] of facts.letters) {
    const rate = errors / attempts;
    if (
      attempts >= ERROR_LETTER_MIN_ATTEMPTS &&
      errors >= ERROR_LETTER_MIN_ERRORS &&
      rate >= ERROR_LETTER_MIN_RATE &&
      rate >= facts.wrongRate * ERROR_LETTER_MIN_LIFT
    ) {
      bad.push({ letter, errors, rate });
    }
  }
  if (bad.length === 0) return null;
  bad.sort((a, b) => b.errors - a.errors || (a.letter < b.letter ? -1 : 1));
  const top = bad.slice(0, DIAGNOSE_MAX_ITEMS);
  let errors = 0;
  for (const b of top) errors += b.errors;
  const saved = errors * PRESSES_PER_CORRECTION * facts.medianGapMs;
  return { kind: 'error-prone-letters', letters: top.map((b) => b.letter), costWpm: costWpm(facts.netWpm, facts.elapsedMs, saved) };
}

function hesitationFinding(facts: RunFacts): Diagnosis | null {
  const long = facts.starts.filter((x) => x.len >= HESITATION_LONG_WORD).map((x) => x.ms);
  const short = facts.starts.filter((x) => x.len <= HESITATION_SHORT_WORD).map((x) => x.ms);
  if (long.length < HESITATION_MIN_COUNT || short.length < HESITATION_MIN_COUNT) return null;
  const longMedian = median(long);
  const shortMedian = median(short);
  const gapMs = longMedian - shortMedian;
  if (gapMs < HESITATION_MIN_GAP_MS || longMedian < shortMedian * HESITATION_MIN_RATIO) return null;
  return { kind: 'hesitation-before-long-words', gapMs: round2(gapMs), costWpm: costWpm(facts.netWpm, facts.elapsedMs, long.length * gapMs) };
}

function correctionFinding(facts: RunFacts): Diagnosis | null {
  if (facts.corrections < CORRECTION_MIN_COUNT || facts.corrections < facts.keys * CORRECTION_MIN_RATE) return null;
  const saved = facts.corrections * PRESSES_PER_CORRECTION * facts.medianGapMs;
  return { kind: 'too-much-correction', corrections: facts.corrections, costWpm: costWpm(facts.netWpm, facts.elapsedMs, saved) };
}

/** The costliest finding that clears its minimum counts. Structured data only: wording belongs to the interface. */
export function diagnose(cfg: Config, words: readonly string[], entries: readonly LogEntry[]): Diagnosis {
  const nothing: Diagnosis = { kind: 'nothing-notable', costWpm: 0 };
  const facts = collect(cfg, words, entries);
  if (facts.keys < DIAGNOSE_MIN_KEYS) return nothing;
  let best: Diagnosis = nothing;
  for (const finding of [slowPairsFinding(facts), errorLettersFinding(facts), hesitationFinding(facts), correctionFinding(facts)]) {
    if (finding !== null && finding.costWpm >= DIAGNOSE_MIN_COST_WPM && finding.costWpm > best.costWpm) best = finding;
  }
  return best;
}

/** Real words holding the weak pairs, taking the pairs in turn so a rare pair is not drowned out by a common one. */
export function drillWords(list: readonly string[], weakPairs: readonly string[], seed: string, count: number): string[] {
  const rng = xoshiro128pp(streamFromHex(seed, STREAM_DRILL));
  const pools = weakPairs.map((pair) => list.filter((word) => word.includes(pair))).filter((pool) => pool.length > 0);
  if (pools.length === 0) return [];
  const out: string[] = [];
  const recent = (word: string | undefined): boolean => {
    for (let j = out.length - 1; j >= 0 && j >= out.length - DRILL_NO_REPEAT; j--) if (out[j] === word) return true;
    return false;
  };
  for (let i = 0; i < count; i++) {
    const pool = pools[i % pools.length] ?? [];
    let at = rng.int(pool.length);
    for (let tries = 0; tries < REDRAWS && recent(pool[at]); tries++) at = rng.int(pool.length);
    // As in generateWords, the scan draws nothing. A pool under 4 words cannot always obey the window, and then it repeats.
    for (let scan = 0; scan < pool.length && recent(pool[at]); scan++) at = (at + 1) % pool.length;
    out.push(pool[at] ?? '');
  }
  return out;
}

/** percentile_cont(0.8), the same double operations as Postgres's orderedsetaggs.c and float8_lerp, not rounded. */
export function paceOf(wpmCxValues: readonly number[]): number | null {
  if (wpmCxValues.length === 0) return null;
  const sorted = [...wpmCxValues].sort((a, b) => a - b);
  const position = 0.8 * (sorted.length - 1);
  const firstRow = Math.floor(position);
  const secondRow = Math.ceil(position);
  const first = sorted[firstRow] ?? 0;
  if (firstRow === secondRow) return first;
  return first + (position - firstRow) * ((sorted[secondRow] ?? 0) - first);
}

// Share of typists below each 5 WPM step, in tenths of a percent: a skew-normal matched to the mean (51.56), SD (20.2)
// and skewness (0.513) published by Dhakal et al. 2018. Only those summaries are used: the dataset itself is non-commercial.
const REFERENCE_CDF = [1, 2, 7, 18, 39, 76, 133, 210, 303, 405, 507, 604, 690, 764, 824, 872, 910, 938, 958, 972, 982, 989, 993, 996, 998, 999, 999, 1000];
const REFERENCE_STEP = 5;

function referenceShare(wpm: number): number {
  const position = Math.max(0, wpm) / REFERENCE_STEP;
  const below = Math.min(Math.floor(position), REFERENCE_CDF.length - 1);
  const low = REFERENCE_CDF[below] ?? 1000;
  const high = REFERENCE_CDF[below + 1] ?? 1000;
  return (low + (position - below) * (high - low)) / 10;
}

/** "Faster than about N%": held to 1..99, since a fitted curve cannot claim the first or last typist. */
export function percentileOf(wpm: number): number {
  return Math.min(99, Math.max(1, Math.round(referenceShare(wpm))));
}

/** The speed that beats N percent of the same reference, so board rows and sentences can never disagree. */
export function wpmAtPercentile(percent: number): number {
  const target = Math.min(99.9, Math.max(0, percent));
  let low = 0;
  let high = REFERENCE_STEP * (REFERENCE_CDF.length - 1);
  for (let i = 0; i < 24; i++) {
    const middle = (low + high) / 2;
    if (referenceShare(middle) < target) low = middle;
    else high = middle;
  }
  return Math.round(high);
}

/** Measured in integer centi-WPM so that 78.1 reads 1.9 away and not 1.9000000000000057. */
export function nextDecade(wpm: number): { target: number; distance: number } {
  const cx = Math.round(Math.max(0, wpm) * 100);
  const target = (Math.floor(cx / 1000) + 1) * 10;
  return { target, distance: (target * 100 - cx) / 100 };
}
