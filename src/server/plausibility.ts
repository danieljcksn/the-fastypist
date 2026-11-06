import { z } from 'zod';
import type { LogEntry } from '@/engine/core';

// The repository holds only this schema. Real values live in the PLAUSIBILITY environment variable, because anyone who can
// read a threshold can tune a bot to sit just inside it. Shares are 0 to 1, centi-WPM throughout.
const configSchema = z.strictObject({
  gateWpmCx: z.number().int().nonnegative(),
  minKeys: z.number().int().nonnegative(),
  ikiCvMin: z.number(),
  logIkiKurtosisMin: z.number(),
  holdCvMin: z.number(),
  meanHoldMinMs: z.number(),
  shortHoldMaxShare: z.number(),
  missingKeyupMaxShare: z.number(),
  shortIkiMaxShare: z.number(),
  ikiEntropyMinBits: z.number(),
  peakRatioMax: z.number(),
  ceilingCx: z.strictObject({ long: z.number().int(), short: z.number().int() }),
  holdAboveCx: z.number().int().optional(),
  paceMultiple: z.number().optional(),
  todayPaceMultiple: z.number().optional(),
  paceMinRuns: z.number().int().optional(),
  bestMultiple: z.number().optional(),
  bestMinRuns: z.number().int().optional(),
  boardTop: z.number().int().optional(),
  stampEarlyMs: z.number().int().nonnegative(),
  stampLateMs: z.number().int().nonnegative(),
});

export type PlausibilityConfig = z.infer<typeof configSchema>;

/** What applies with the variable absent: far above any human, so it only catches a forged log. */
export const LOOSE_CEILING_CX = 40_000;

/** From PLAN: while a board is small, rank-based holds would quarantine every run on it. */
export const BOARD_TRIGGER_MIN_ENTRIES = 1000;

const SHORT_RUN_MAX_SECONDS = 30;
const SHORT_IKI_MS = 15;
const SHORT_HOLD_MS = 15;
const MAX_IKI_MS = 5000;
const MAX_HOLD_MS = 2000;
const PAUSE_MEDIANS = 2.5;
const ENTROPY_BIN_MS = 5;
const PEAK_WINDOW_KEYS = 50;

let cache: { raw: string | undefined; config: PlausibilityConfig | null } | undefined;

/** Null when absent. A value that doesn't parse also gives null and an error: a typo must not hold every run on the board. */
export function plausibilityConfig(): PlausibilityConfig | null {
  const raw = process.env.PLAUSIBILITY;
  if (cache !== undefined && cache.raw === raw) return cache.config;
  let config: PlausibilityConfig | null = null;
  if (raw !== undefined && raw !== '') {
    try {
      config = configSchema.parse(JSON.parse(raw));
    } catch {
      // Says nothing about the contents, which must not reach logs.
      console.error('PLAUSIBILITY is set but invalid, applying only the loose ceiling');
    }
  }
  cache = { raw, config };
  return config;
}

/**
 * Definitions follow the analysis behind the thresholds, because a threshold means nothing on another definition: intervals
 * over 5 s are not typing, "pauses removed" is under 2.5 medians, and peak speed is against the run's own mean.
 * Hold-derived values exist only in this object, which lives as long as the request. They are never written anywhere.
 */
export interface Features {
  keys: number;
  ikiCv: number | null;
  logIkiKurtosis: number | null;
  holdCv: number | null;
  meanHoldMs: number | null;
  shortHoldShare: number | null;
  missingKeyupShare: number;
  shortIkiShare: number | null;
  ikiEntropyBits: number | null;
  peakRatio: number | null;
}

function meanOf(values: readonly number[]): number {
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function stdevOf(values: readonly number[], mean: number): number {
  let squares = 0;
  for (const v of values) squares += (v - mean) * (v - mean);
  return Math.sqrt(squares / values.length);
}

function excessKurtosis(values: readonly number[]): number {
  const mean = meanOf(values);
  let m2 = 0;
  let m4 = 0;
  for (const v of values) {
    const d = (v - mean) * (v - mean);
    m2 += d;
    m4 += d * d;
  }
  m2 /= values.length;
  m4 /= values.length;
  // No spread at all is as flat as a distribution gets, and -3 is the lower bound of excess kurtosis.
  return m2 > 0 ? m4 / (m2 * m2) - 3 : -3;
}

function entropyBits(values: readonly number[]): number {
  const bins = new Map<number, number>();
  for (const v of values) {
    const bin = Math.floor(v / ENTROPY_BIN_MS);
    bins.set(bin, (bins.get(bin) ?? 0) + 1);
  }
  let bits = 0;
  for (const count of bins.values()) {
    const p = count / values.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

function peakRatio(entries: readonly LogEntry[]): number | null {
  const first = entries[0];
  const last = entries[entries.length - 1];
  if (first === undefined || last === undefined || last.t <= first.t) return null;
  const meanSpeed = (entries.length - 1) / (last.t - first.t);
  let peak = 0;
  for (let i = 0; i + PEAK_WINDOW_KEYS < entries.length; i++) {
    const from = entries[i];
    const to = entries[i + PEAK_WINDOW_KEYS];
    if (from === undefined || to === undefined) continue;
    const span = to.t - from.t;
    if (span > 0 && PEAK_WINDOW_KEYS / span > peak) peak = PEAK_WINDOW_KEYS / span;
  }
  return peak > 0 ? peak / meanSpeed : null;
}

/** Takes the keys that belong to the run, from entriesInRun, in memory only. */
export function extractFeatures(entries: readonly LogEntry[]): Features {
  const ikis: number[] = [];
  for (let i = 1; i < entries.length; i++) {
    const gap = (entries[i]?.t ?? 0) - (entries[i - 1]?.t ?? 0);
    if (gap >= 0 && gap <= MAX_IKI_MS) ikis.push(gap);
  }
  const holds: number[] = [];
  let missing = 0;
  for (const entry of entries) {
    if (entry.h === undefined) missing++;
    else if (entry.h < MAX_HOLD_MS) holds.push(entry.h);
  }
  const sorted = [...ikis].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const typing = ikis.filter((gap) => gap > 0 && gap < PAUSE_MEDIANS * median);
  const typingMean = typing.length > 0 ? meanOf(typing) : 0;
  const holdMean = holds.length > 0 ? meanOf(holds) : 0;
  const logs = typing.map((gap) => Math.log(gap));
  const allSimultaneous = ikis.length > 0 && typing.length === 0;
  return {
    keys: entries.length,
    // Every key at one instant leaves no typing intervals at all, which is the extreme of no variation, not missing data.
    ikiCv: allSimultaneous ? 0 : typing.length > 0 ? stdevOf(typing, typingMean) / typingMean : null,
    logIkiKurtosis: allSimultaneous ? -3 : logs.length > 0 ? excessKurtosis(logs) : null,
    holdCv: holds.length === 0 ? null : holdMean > 0 ? stdevOf(holds, holdMean) / holdMean : 0,
    meanHoldMs: holds.length > 0 ? holdMean : null,
    shortHoldShare: holds.length > 0 ? holds.filter((h) => h < SHORT_HOLD_MS).length / holds.length : null,
    missingKeyupShare: entries.length > 0 ? missing / entries.length : 0,
    shortIkiShare: ikis.length > 0 ? ikis.filter((gap) => gap < SHORT_IKI_MS).length / ikis.length : null,
    ikiEntropyBits: allSimultaneous ? 0 : typing.length > 0 ? entropyBits(typing) : null,
    peakRatio: peakRatio(entries),
  };
}

export interface RunFacts {
  wpmCx: number;
  mode: 'time' | 'words';
  amount: number;
  features: Features;
}

function ceilingFor(config: PlausibilityConfig, facts: RunFacts): number {
  return facts.mode === 'time' && facts.amount > SHORT_RUN_MAX_SECONDS ? config.ceilingCx.long : config.ceilingCx.short;
}

const below = (value: number | null, floor: number): boolean => value !== null && value < floor;
const above = (value: number | null, limit: number): boolean => value !== null && value > limit;

/** Names of the checks that tripped. Any name holds the run: nothing here rejects, and nothing reads as guilt. */
export function checkRun(facts: RunFacts, config: PlausibilityConfig | null): string[] {
  if (config === null) return facts.wpmCx > LOOSE_CEILING_CX ? ['ceiling'] : [];
  const reasons: string[] = [];
  if (facts.wpmCx > ceilingFor(config, facts)) reasons.push('ceiling');
  if (facts.wpmCx < config.gateWpmCx) return reasons;
  if (config.holdAboveCx !== undefined && facts.wpmCx > config.holdAboveCx) reasons.push('above-review-speed');
  const f = facts.features;
  if (f.keys < config.minKeys) return reasons;
  if (below(f.ikiCv, config.ikiCvMin)) reasons.push('iki-cv');
  if (below(f.logIkiKurtosis, config.logIkiKurtosisMin)) reasons.push('iki-kurtosis');
  if (below(f.holdCv, config.holdCvMin)) reasons.push('hold-cv');
  if (below(f.meanHoldMs, config.meanHoldMinMs)) reasons.push('mean-hold');
  if (above(f.shortHoldShare, config.shortHoldMaxShare)) reasons.push('short-holds');
  if (f.missingKeyupShare > config.missingKeyupMaxShare) reasons.push('missing-keyups');
  if (above(f.shortIkiShare, config.shortIkiMaxShare)) reasons.push('short-ikis');
  if (below(f.ikiEntropyBits, config.ikiEntropyMinBits)) reasons.push('iki-entropy');
  if (above(f.peakRatio, config.peakRatioMax)) reasons.push('peak-burst');
  return reasons;
}

export interface StandingFacts {
  wpmCx: number;
  daily: boolean;
  paceCx: number | null;
  runsInWindow: number;
  bestCx: number | null;
  /** Where the run would land, on Today for a daily run and Standings otherwise. */
  board: { rank: number; total: number } | null;
}

/** The checks that need the typist's history, so these run inside the submit transaction. */
export function checkStanding(facts: StandingFacts, config: PlausibilityConfig | null): string[] {
  if (config === null || facts.wpmCx < config.gateWpmCx) return [];
  const reasons: string[] = [];
  const multiple = facts.daily ? config.todayPaceMultiple : config.paceMultiple;
  if (
    multiple !== undefined &&
    facts.paceCx !== null &&
    facts.runsInWindow >= (config.paceMinRuns ?? 0) &&
    facts.wpmCx > facts.paceCx * multiple
  ) {
    reasons.push('above-pace');
  }
  if (
    config.bestMultiple !== undefined &&
    facts.bestCx !== null &&
    facts.runsInWindow >= (config.bestMinRuns ?? 0) &&
    facts.wpmCx > facts.bestCx * config.bestMultiple
  ) {
    reasons.push('above-best');
  }
  if (
    config.boardTop !== undefined &&
    facts.board !== null &&
    facts.board.total >= BOARD_TRIGGER_MIN_ENTRIES &&
    facts.board.rank <= config.boardTop
  ) {
    reasons.push('board-top');
  }
  return reasons;
}

/** Whether a board-size check could matter, so a submit below the gate skips the query. */
export function needsBoardRank(wpmCx: number, config: PlausibilityConfig | null): boolean {
  return config !== null && config.boardTop !== undefined && wpmCx >= config.gateWpmCx;
}
