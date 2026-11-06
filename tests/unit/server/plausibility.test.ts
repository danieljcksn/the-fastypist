import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LogEntry } from '@/engine/core';
import {
  BOARD_TRIGGER_MIN_ENTRIES,
  LOOSE_CEILING_CX,
  type PlausibilityConfig,
  type RunFacts,
  checkRun,
  checkStanding,
  extractFeatures,
  needsBoardRank,
  plausibilityConfig,
} from '@/server/plausibility';
import { PLAUSIBILITY_FIXTURE, PLAUSIBILITY_FIXTURE_JSON } from './helpers/fixtures';
import { constantShape, humanShape, instantKeyupShape, noKeyupShape, typed, uniformJitterShape } from './helpers/logs';

const WORDS = Array.from({ length: 800 }, (_, i) => ['house', 'river', 'table', 'quick', 'plant', 'sound', 'light', 'water'][i % 8] ?? 'word');
const SIXTY = 60_000;

const facts = (entries: LogEntry[], wpm = 150): RunFacts => ({ wpmCx: wpm * 100, mode: 'time', amount: 60, features: extractFeatures(entries) });
const config: PlausibilityConfig = PLAUSIBILITY_FIXTURE;

describe('feature extraction', () => {
  it('measures a constant log as no variation at all', () => {
    const f = extractFeatures(typed(WORDS, SIXTY, constantShape(150)));
    expect(f.ikiCv).toBeCloseTo(0, 1);
    expect(f.ikiEntropyBits).toBeLessThan(1.1);
    expect(f.peakRatio).toBeCloseTo(1, 1);
    expect(f.missingKeyupShare).toBe(0);
    expect(f.meanHoldMs).toBe(60);
    expect(f.holdCv).toBe(0);
  });

  it('counts only intervals under 15 ms as short and only holds under 15 ms as short', () => {
    const entries: LogEntry[] = [
      { k: 'c', ch: 'a', t: 0, h: 14 },
      { k: 'c', ch: 'b', t: 14, h: 15 },
      { k: 'c', ch: 'c', t: 29, h: 90 },
      { k: 'c', ch: 'd', t: 129 },
    ];
    const f = extractFeatures(entries);
    expect(f.shortIkiShare).toBeCloseTo(1 / 3);
    expect(f.shortHoldShare).toBeCloseTo(1 / 3);
    expect(f.missingKeyupShare).toBe(0.25);
  });

  it('removes pauses from the variation it measures', () => {
    const steady: LogEntry[] = Array.from({ length: 300 }, (_, i) => ({ k: 'c', ch: 'a', t: i * 100 }));
    const paused: LogEntry[] = steady.map((e, i) => ({ ...e, t: e.t + (i >= 150 ? 4000 : 0) }));
    expect(extractFeatures(paused).ikiCv).toBeCloseTo(extractFeatures(steady).ikiCv ?? -1, 5);
  });

  it('treats every key at one instant as the extreme, not as missing data', () => {
    const f = extractFeatures(Array.from({ length: 300 }, () => ({ k: 'c', ch: 'a', t: 5 }) as LogEntry));
    expect(f.ikiCv).toBe(0);
    expect(f.logIkiKurtosis).toBe(-3);
    expect(f.ikiEntropyBits).toBe(0);
    expect(f.shortIkiShare).toBe(1);
  });

  it('copes with an empty log and a single key', () => {
    expect(extractFeatures([]).keys).toBe(0);
    expect(extractFeatures([{ k: 'c', ch: 'a', t: 0 }]).ikiCv).toBeNull();
  });

  it('finds a burst against the run’s own mean speed', () => {
    const entries: LogEntry[] = [];
    let t = 0;
    for (let i = 0; i < 400; i++) {
      entries.push({ k: 'c', ch: 'a', t });
      t += i >= 200 && i < 260 ? 20 : 100;
    }
    expect(extractFeatures(entries).peakRatio).toBeGreaterThan(3);
  });
});

describe('the decision', () => {
  it('passes a typical human-shaped log at speed', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const entries = typed(WORDS, SIXTY, humanShape(150), seed);
      expect(checkRun(facts(entries), config), `seed ${seed}`).toEqual([]);
    }
  });

  it('holds a constant-interval log', () => {
    const reasons = checkRun(facts(typed(WORDS, SIXTY, constantShape(150))), config);
    expect(reasons).toContain('iki-cv');
    expect(reasons).toContain('iki-entropy');
    expect(reasons).toContain('hold-cv');
  });

  it('holds an instant-keyup log', () => {
    const reasons = checkRun(facts(typed(WORDS, SIXTY, instantKeyupShape(150))), config);
    expect(reasons).toContain('mean-hold');
    expect(reasons).toContain('short-holds');
  });

  it('holds uniform jitter on the shape of its intervals', () => {
    expect(checkRun(facts(typed(WORDS, SIXTY, uniformJitterShape(150))), config)).toContain('iki-kurtosis');
  });

  it('holds a log with no keyups', () => {
    expect(checkRun(facts(typed(WORDS, SIXTY, noKeyupShape(150))), config)).toContain('missing-keyups');
  });

  it('looks at nothing under the gate, however robotic', () => {
    expect(checkRun(facts(typed(WORDS, SIXTY, constantShape(100)), 100), config)).toEqual([]);
  });

  it('applies the feature checks from the gate up, inclusive', () => {
    const entries = typed(WORDS, SIXTY, constantShape(150));
    const at = { ...facts(entries), wpmCx: config.gateWpmCx };
    expect(checkRun(at, config)).toContain('iki-cv');
    expect(checkRun({ ...at, wpmCx: config.gateWpmCx - 1 }, config)).toEqual([]);
  });

  it('skips the statistical checks on too few keys, keeping the ceiling', () => {
    const short = typed(WORDS, 5_000, constantShape(150));
    expect(short.length).toBeLessThan(config.minKeys);
    expect(checkRun(facts(short), config)).toEqual([]);
    expect(checkRun(facts(short, 900), config)).toContain('ceiling');
  });

  it('uses the short ceiling for 15 s and 30 s and word runs, and the long one otherwise', () => {
    const f = extractFeatures([]);
    const between = config.ceilingCx.long + 1;
    expect(checkRun({ wpmCx: between, mode: 'time', amount: 60, features: f }, config)).toContain('ceiling');
    expect(checkRun({ wpmCx: between, mode: 'time', amount: 120, features: f }, config)).toContain('ceiling');
    expect(checkRun({ wpmCx: between, mode: 'time', amount: 30, features: f }, config)).not.toContain('ceiling');
    expect(checkRun({ wpmCx: between, mode: 'words', amount: 100, features: f }, config)).not.toContain('ceiling');
  });

  it('applies only the loose ceiling with no configuration', () => {
    const robot = typed(WORDS, SIXTY, constantShape(300));
    expect(checkRun(facts(robot, 300), null)).toEqual([]);
    expect(checkRun({ ...facts(robot), wpmCx: LOOSE_CEILING_CX }, null)).toEqual([]);
    expect(checkRun({ ...facts(robot), wpmCx: LOOSE_CEILING_CX + 1 }, null)).toEqual(['ceiling']);
  });
});

describe('standing checks', () => {
  const base = { wpmCx: 15000, daily: false, paceCx: 14000, runsInWindow: 25, bestCx: 15000, board: null };

  it('holds a jump above Pace, tighter on Today', () => {
    expect(checkStanding(base, config)).toEqual([]);
    expect(checkStanding({ ...base, wpmCx: 18500 }, config)).toContain('above-pace');
    expect(checkStanding({ ...base, wpmCx: 16400, daily: true }, config)).toContain('above-pace');
    expect(checkStanding({ ...base, wpmCx: 16400 }, config)).not.toContain('above-pace');
  });

  it('leaves a typist with too little history alone', () => {
    expect(checkStanding({ ...base, wpmCx: 30000, runsInWindow: 2 }, config)).toEqual([]);
    expect(checkStanding({ ...base, wpmCx: 30000, paceCx: null, bestCx: null, runsInWindow: 0 }, config)).toEqual([]);
  });

  it('never fires a board trigger on a small board, whatever the rank', () => {
    const small = { ...base, board: { rank: 1, total: BOARD_TRIGGER_MIN_ENTRIES - 1 } };
    const large = { ...base, board: { rank: 1, total: BOARD_TRIGGER_MIN_ENTRIES } };
    const deep = { ...base, board: { rank: 5000, total: 10_000 } };
    expect(checkStanding(small, config)).toEqual([]);
    expect(checkStanding(large, config)).toEqual(['board-top']);
    expect(checkStanding(deep, config)).toEqual([]);
  });

  it('does nothing under the gate or with no configuration', () => {
    const huge = { ...base, wpmCx: 12000, paceCx: 1000, bestCx: 1000, board: { rank: 1, total: 5000 } };
    expect(checkStanding(huge, config)).toEqual([]);
    expect(checkStanding({ ...huge, wpmCx: 30000 }, null)).toEqual([]);
    expect(needsBoardRank(30000, null)).toBe(false);
    expect(needsBoardRank(config.gateWpmCx - 1, config)).toBe(false);
    expect(needsBoardRank(config.gateWpmCx, config)).toBe(true);
  });
});

describe('the environment variable', () => {
  const saved = process.env.PLAUSIBILITY;
  afterEach(() => {
    if (saved === undefined) delete process.env.PLAUSIBILITY;
    else process.env.PLAUSIBILITY = saved;
    vi.restoreAllMocks();
  });

  it('reads as null when absent', () => {
    delete process.env.PLAUSIBILITY;
    expect(plausibilityConfig()).toBeNull();
  });

  it('parses a valid value', () => {
    process.env.PLAUSIBILITY = PLAUSIBILITY_FIXTURE_JSON;
    expect(plausibilityConfig()).toEqual(PLAUSIBILITY_FIXTURE);
  });

  it('falls back to the loose ceiling on an invalid value, naming no contents', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.PLAUSIBILITY = '{"gateWpmCx":"secret-value"}';
    expect(plausibilityConfig()).toBeNull();
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-value');
    process.env.PLAUSIBILITY = 'not json';
    expect(plausibilityConfig()).toBeNull();
  });

  it('rejects an unknown key, so a typo in a threshold name cannot pass silently', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.PLAUSIBILITY = JSON.stringify({ ...PLAUSIBILITY_FIXTURE, ikiCvMinn: 1 });
    expect(plausibilityConfig()).toBeNull();
  });
});
