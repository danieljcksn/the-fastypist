import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  consistency,
  diagnose,
  drillWords,
  entriesInRun,
  errorBreakdown,
  letterPairs,
  nextDecade,
  paceOf,
  percentileOf,
  wpmAtPercentile,
  rollover,
  speedSeries,
  wordTimings,
} from '@/engine/analysis';
import { type Config, type LogEntry, WORDS_MAX_ELAPSED_MS, expire } from '@/engine/core';
import { replay } from '@/engine/replay';
import { RUNS, WORDS_CFG, arbRun, arbSeed, opsFrom, run } from './arbitraries';

const SEED = '6cd115b9544df1866a971ce4a21cae60';
const time = (durationMs: number): Config => ({ ...WORDS_CFG, mode: 'time', durationMs });

/** Types `keys`; `gap` gives the wait before key i. */
function timed(keys: string, gap: (i: number, ch: string, prev: string) => number): LogEntry[] {
  const out: LogEntry[] = opsFrom(keys, 0);
  let t = 0;
  out.forEach((e, i) => {
    if (i > 0) t += gap(i, keys.charAt(i), keys.charAt(i - 1));
    e.t = t;
  });
  return out;
}

const metronome = (n: number, gap = 100): LogEntry[] => Array.from({ length: n }, (_, i): LogEntry => ({ k: 'c', ch: 'a', t: i * gap }));

describe('consistency', () => {
  it('is null under 5 windows and 100 for a metronome', () => {
    expect(consistency(metronome(100))).toBeNull();
    expect(consistency(metronome(101))).toBe(100);
  });

  it('matches 100·e^(−cv) by hand', () => {
    // Five windows of 20 keys at gaps 100,100,100,200,200 ms give speeds of 1/100 and 1/200 per ms.
    const entries: LogEntry[] = [];
    let t = 0;
    for (const gap of [100, 100, 100, 200, 200]) {
      for (let i = 0; i < 20; i++) {
        entries.push({ k: 'c', ch: 'a', t });
        t += gap;
      }
    }
    entries.push({ k: 'c', ch: 'a', t });
    const speeds = [0.01, 0.01, 0.01, 0.005, 0.005];
    const mean = speeds.reduce((a, b) => a + b) / 5;
    const sd = Math.sqrt(speeds.reduce((a, b) => a + (b - mean) * (b - mean), 0) / 5);
    expect(consistency(entries)).toBeCloseTo(100 * Math.exp(-sd / mean), 9);
  });

  it('skips windows with no elapsed time, as phone keyboards produce', () => {
    const entries = Array.from({ length: 201 }, (_, i): LogEntry => ({ k: 'c', ch: 'a', t: i <= 100 ? 0 : (i - 100) * 100 }));
    expect(consistency(entries)).toBe(100);
  });

  it('stays in (0,100]', () => {
    fc.assert(
      fc.property(fc.array(fc.nat(2000), { minLength: 101, maxLength: 400 }), (gaps) => {
        let t = 0;
        const value = consistency(gaps.map((g): LogEntry => ({ k: 'c', ch: 'a', t: (t += g + 1) })));
        return value !== null && value > 0 && value <= 100;
      }),
      RUNS,
    );
  });
});

describe('entriesInRun', () => {
  it('drops keys before the clock started and at or past the cut', () => {
    const entries: LogEntry[] = [{ k: 's', t: 0 }, { k: 'b', t: 1 }, { k: 'd', t: 10 }, { k: 'c', ch: 'a', t: 1009 }, { k: 'c', ch: 'b', t: 1010 }];
    const words = ['abc', 'next'];
    expect(entriesInRun(time(1000), words, entries).map((e) => e.t)).toEqual([10, 1009]);
    expect(entriesInRun(WORDS_CFG, words, entries).map((e) => e.t)).toEqual([10, 1009, 1010]);
    expect(entriesInRun(WORDS_CFG, words, [{ k: 's', t: 0 }])).toEqual([]);
  });

  it('drops keys after the run finished, in words mode and when a time run\'s text ran out', () => {
    expect(entriesInRun(WORDS_CFG, ['ab'], opsFrom('ab xxx'))).toHaveLength(2);
    expect(entriesInRun(time(60_000), ['ab'], opsFrom('ab xxx'))).toHaveLength(2);
    expect(entriesInRun(WORDS_CFG, ['ab'], opsFrom('zz xxx'))).toHaveLength(3);
  });

  it('keeps trailing keys out of consistency', () => {
    const words = Array.from({ length: 30 }, () => 'abcd');
    const clean = opsFrom(words.join(' '), 100);
    const end = clean.at(-1)?.t ?? 0;
    const trailing: LogEntry[] = [...clean, ...Array.from({ length: 100 }, (_, i): LogEntry => ({ k: 's', t: end + 1 + i }))];
    expect(consistency(entriesInRun(WORDS_CFG, words, trailing))).toBe(consistency(clean));
    expect(consistency(clean)).toBe(100);
  });

  it('drops nothing that moves a score: only ignored keys before the clock, and everything after the finish', () => {
    fc.assert(
      fc.property(arbRun, ([c, w, o]) => {
        const kept = replay(c, w, entriesInRun(c, w, o)).score;
        const all = replay(c, w, o).score;
        return JSON.stringify({ ...kept, ignored: 0 }) === JSON.stringify({ ...all, ignored: 0 });
      }),
      RUNS,
    );
  });
});

describe('speedSeries', () => {
  it('computes raw, net and errors per second', () => {
    // Words of 2 letters: keys at 0,400,800 ms (ab␠) then 1200,1600,2000 (cd␠).
    const entries = opsFrom('ab cx ', 400);
    const series = speedSeries(time(3000), ['ab', 'cd', 'ef'], entries);
    expect(series).toHaveLength(3);
    expect(series[0]).toEqual({ second: 1, raw: 36, net: 36, errors: 0 });
    expect(series[1]).toEqual({ second: 2, raw: 36, net: 18, errors: 1 });
    expect(series[2]).toEqual({ second: 3, raw: 0, net: 12, errors: 0 });
  });

  it('its last net is the score, and its buckets account for every key', () => {
    fc.assert(
      fc.property(arbRun, ([c, w, o]) => {
        const r = replay(c, w, o);
        const series = speedSeries(c, w, o);
        if (r.state.phase === 'idle' || r.score.elapsedMs === 0) return series.length === 0;
        if (series.at(-1)?.net !== r.score.wpm) return false;
        let errors = 0;
        for (const point of series) errors += point.errors;
        return errors === r.score.wrongKeys;
      }),
      RUNS,
    );
  });
});

describe('speedSeries on a forged log', () => {
  const ab = ['ab', 'cd'];

  it('stops at the limit replay enforces, instead of one point per claimed second', () => {
    expect(speedSeries(WORDS_CFG, ab, [{ k: 'c', ch: 'a', t: 0 }, { k: 'c', ch: 'b', t: 2 ** 31 }])).toEqual([]);
    const stacked: LogEntry[] = Array.from({ length: 64 }, (_, i): LogEntry => ({ k: 'c', ch: 'z', t: i * 2 ** 31 }));
    expect(speedSeries(WORDS_CFG, ab, stacked)).toEqual([]);
  });

  it('still draws a run of exactly the limit', () => {
    const entries: LogEntry[] = [{ k: 'c', ch: 'a', t: 0 }, { k: 'c', ch: 'b', t: WORDS_MAX_ELAPSED_MS }];
    expect(speedSeries(WORDS_CFG, ab, entries)).toHaveLength(WORDS_MAX_ELAPSED_MS / 1000);
  });
});

describe('words-mode series', () => {
  it('its last net is the score, credit rule included', () => {
    const r = replay(WORDS_CFG, ['ab', 'cd'], opsFrom('ab cd', 300));
    expect(r.score.wpm).toBe(40);
    expect(speedSeries(WORDS_CFG, ['ab', 'cd'], opsFrom('ab cd', 300)).at(-1)?.net).toBe(40);
  });

  it('its raw counts repeated presses, as the score does', () => {
    const entries = opsFrom('a<a<a<ab', 100);
    const r = replay(WORDS_CFG, ['ab'], entries).score;
    expect(r.repeatKeys).toBe(3);
    expect(speedSeries(WORDS_CFG, ['ab'], entries).map((point) => point.raw)).toEqual([r.rawWpm]);
  });
});

describe('wordTimings', () => {
  it('runs commit to commit, so the pause before a word is that word\'s', () => {
    const entries = timed('ab cd', (i) => (i === 3 ? 900 : 100));
    const timings = wordTimings(WORDS_CFG, ['ab', 'cd'], entries);
    expect(timings.map((x) => x.ms)).toEqual([200, 1000]);
    expect(timings[0]).toEqual({ w: 0, ms: 200, wpm: 180, correct: true, committed: true });
    expect(timings[1]?.wpm).toBe(24);
  });

  it('reopens a wrong word when the typist returns to it', () => {
    const entries = opsFrom('ax <<b cd', 100);
    const timings = wordTimings(WORDS_CFG, ['ab', 'cd'], entries);
    expect(timings.map((x) => x.ms)).toEqual([600, 200]);
    expect(timings[0]?.correct).toBe(true);
  });

  it('includes the unfinished word in a time run', () => {
    const timings = wordTimings(time(1000), ['ab', 'cd'], opsFrom('ab c', 100));
    expect(timings.map((x) => x.ms)).toEqual([200, 800]);
    expect(timings[1]?.committed).toBe(false);
  });

  it('sums to the run, and to T unless the text ran out', () => {
    fc.assert(
      fc.property(arbRun, ([c, w, o]) => {
        const s = run(c, w, o);
        expire(c, s);
        const timings = wordTimings(c, w, o);
        if (s.phase === 'idle') return timings.length === 0;
        let sum = 0;
        for (const x of timings) {
          if (x.ms < 0) return false;
          sum += x.ms;
        }
        const end = s.phase === 'finished' ? s.endT : s.lastT;
        if (sum !== end - s.startT) return false;
        return c.mode !== 'time' || s.allCommitted || sum === c.durationMs;
      }),
      RUNS,
    );
  });
});

describe('errorBreakdown', () => {
  const of = (target: string, typed: string) => {
    const words = [target, 'next'];
    const s = run(WORDS_CFG, words, opsFrom(`${typed} `));
    return errorBreakdown(words, s);
  };

  it('classifies each kind', () => {
    expect(of('the', 'teh')).toEqual({ substitution: 0, omission: 0, insertion: 0, transposition: 1, wrongWords: 1 });
    expect(of('the', 'tha')).toEqual({ substitution: 1, omission: 0, insertion: 0, transposition: 0, wrongWords: 1 });
    expect(of('the', 'th')).toEqual({ substitution: 0, omission: 1, insertion: 0, transposition: 0, wrongWords: 1 });
    expect(of('the', 'thee')).toEqual({ substitution: 0, omission: 0, insertion: 1, transposition: 0, wrongWords: 1 });
    expect(of('coração', 'cor')).toEqual({ substitution: 0, omission: 4, insertion: 0, transposition: 0, wrongWords: 1 });
  });

  it('ignores correct words and a clean prefix the clock cut off', () => {
    expect(of('the', 'the').wrongWords).toBe(0);
    const words = ['the', 'next'];
    expect(errorBreakdown(words, run(WORDS_CFG, words, opsFrom('th'))).wrongWords).toBe(0);
    expect(errorBreakdown(words, run(WORDS_CFG, words, opsFrom('the'))).wrongWords).toBe(0);
  });

  it('counts a cut word with a wrong letter, but not the letters it never reached', () => {
    const words = ['abc', 'defgh', 'ghi'];
    const r = replay(time(1000), words, opsFrom('abc dx'));
    expect(r.score.wordsWrong).toBe(1);
    expect(errorBreakdown(words, r.state)).toEqual({ substitution: 1, omission: 0, insertion: 0, transposition: 0, wrongWords: 1 });
    const extra = replay(time(1000), ['ab', 'cd'], opsFrom('abx'));
    expect(errorBreakdown(['ab', 'cd'], extra.state)).toEqual({ substitution: 0, omission: 0, insertion: 1, transposition: 0, wrongWords: 1 });
  });

  it('agrees with the score on how many words are wrong', () => {
    fc.assert(
      fc.property(arbRun, ([c, w, o]) => {
        const r = replay(c, w, o);
        return errorBreakdown(w, r.state).wrongWords === r.score.wordsWrong;
      }),
      RUNS,
    );
  });

  it('counts a wrong last word once it is committed', () => {
    const words = ['the'];
    expect(errorBreakdown(words, run(WORDS_CFG, words, opsFrom('th '))).omission).toBe(1);
  });

  it('every committed wrong word yields at least one error', () => {
    fc.assert(
      fc.property(arbRun, ([c, w, o]) => {
        const b = errorBreakdown(w, replay(c, w, o).state);
        return b.substitution + b.omission + b.insertion + b.transposition >= b.wrongWords;
      }),
      RUNS,
    );
  });
});

describe('rollover', () => {
  const pairs = (n: number, gap: number, h: number | undefined): LogEntry[] =>
    Array.from({ length: n }, (_, i): LogEntry => (h === undefined ? { k: 'c', ch: 'a', t: i * gap } : { k: 'c', ch: 'a', t: i * gap, h }));

  it('counts the next keydown landing before the previous keyup', () => {
    expect(rollover(pairs(30, 100, 150))).toBe(1);
    expect(rollover(pairs(30, 100, 50))).toBe(0);
    expect(rollover(pairs(30, 100, 100))).toBe(0);
    const half = pairs(31, 100, 50).map((e, i): LogEntry => (i % 2 === 0 ? { ...e, h: 150 } : e));
    expect(rollover(half)).toBe(0.5);
  });

  it('is null when holds are mostly absent or the sample is thin', () => {
    expect(rollover(pairs(30, 100, undefined))).toBeNull();
    const mostlyAbsent = pairs(90, 100, undefined).map((e, i): LogEntry => (i % 3 === 0 ? { ...e, h: 150 } : e));
    expect(rollover(mostlyAbsent)).toBeNull();
    expect(rollover(pairs(10, 100, 150))).toBeNull();
  });
});

describe('letterPairs', () => {
  it('averages correct pairs inside words and prices them against the median', () => {
    const entries = timed('abc abc', (_, ch, prev) => (prev === 'a' && ch === 'b' ? 300 : 100));
    const pairs = letterPairs(WORDS_CFG, ['abc', 'abc'], entries);
    expect(pairs.map((p) => p.pair)).toEqual(['ab', 'bc']);
    expect(pairs[0]).toMatchObject({ pair: 'ab', count: 2, meanMs: 300 });
    expect(pairs[1]).toMatchObject({ pair: 'bc', count: 2, meanMs: 100, costWpm: 0 });
    expect(pairs[0]?.costWpm).toBeGreaterThan(0);
  });

  it('skips pairs broken by a wrong key, a correction, a space or a dead key', () => {
    expect(letterPairs(WORDS_CFG, ['abc'], opsFrom('ax<bc')).map((p) => p.pair)).toEqual(['bc']);
    expect(letterPairs(WORDS_CFG, ['ab', 'cd'], opsFrom('ab cd')).map((p) => p.pair)).toEqual(['ab', 'cd']);
    expect(letterPairs(WORDS_CFG, ['não'], opsFrom('n`ão')).map((p) => p.pair)).toEqual(['ão']);
  });

  it('treats a long gap as a pause, not a slow pair', () => {
    const entries = timed('abc', (i) => (i === 1 ? 5000 : 100));
    expect(letterPairs(WORDS_CFG, ['abc'], entries).map((p) => p.pair)).toEqual(['bc']);
  });

  it('stops at the cut in a time run', () => {
    const pairs = letterPairs(time(250), ['abcd', 'x'], opsFrom('abcd', 100));
    expect(pairs.map((p) => p.pair)).toEqual(['ab', 'bc']);
  });
});

describe('diagnose', () => {
  const words = Array.from({ length: 60 }, () => 'xqab');
  const text = words.join(' ');

  it('stays quiet on a clean run', () => {
    expect(diagnose(WORDS_CFG, words, opsFrom(text))).toEqual({ kind: 'nothing-notable', costWpm: 0 });
  });

  it('finds a slow pair and prices it', () => {
    const entries = timed(text, (_, ch, prev) => (prev === 'q' && ch === 'a' ? 400 : 100));
    const d = diagnose(WORDS_CFG, words, entries);
    expect(d.kind).toBe('slow-pairs');
    if (d.kind === 'slow-pairs') {
      expect(d.pairs).toEqual(['qa']);
      expect(d.costWpm).toBeGreaterThan(1);
    }
  });

  it('will not claim a slow pair from thin data', () => {
    const short = words.slice(0, 15);
    const entries = timed(short.join(' '), (_, ch, prev) => (prev === 'q' && ch === 'a' ? 400 : 100));
    expect(diagnose(WORDS_CFG, short, entries).kind).toBe('nothing-notable');
  });

  it('needs a pair seen enough times, however slow', () => {
    const list = [...Array.from({ length: 40 }, () => 'abab'), 'zk', 'zk', 'zk'];
    const entries = timed(list.join(' '), (_, ch, prev) => (prev === 'z' && ch === 'k' ? 1500 : 100));
    expect(diagnose(WORDS_CFG, list, entries).kind).toBe('nothing-notable');
  });

  it('finds an error-prone letter', () => {
    const list = Array.from({ length: 30 }, () => 'zabc');
    const keys = list.map((word, i) => (i % 6 === 0 ? `y<${word}` : word)).join(' ');
    const d = diagnose(WORDS_CFG, list, opsFrom(keys));
    expect(d.kind).toBe('error-prone-letters');
    if (d.kind === 'error-prone-letters') expect(d.letters).toEqual(['z']);
  });

  it('finds hesitation before long words', () => {
    const list = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 'ab' : 'abcdefgh'));
    const keys = list.join(' ');
    let word = 0;
    const entries = timed(keys, (_, __, prev) => {
      if (prev !== ' ') return 100;
      word++;
      return word % 2 === 1 ? 500 : 100;
    });
    const d = diagnose(WORDS_CFG, list, entries);
    expect(d.kind).toBe('hesitation-before-long-words');
    if (d.kind === 'hesitation-before-long-words') expect(d.gapMs).toBe(400);
  });

  it('finds too much correction', () => {
    const list = Array.from({ length: 30 }, () => 'abcde');
    const keys = list.map((word) => `a<${word}`).join(' ');
    const d = diagnose(WORDS_CFG, list, opsFrom(keys));
    expect(d.kind).toBe('too-much-correction');
    if (d.kind === 'too-much-correction') expect(d.corrections).toBe(30);
  });

  it('prices correction monotonically, and never above doubling the speed', () => {
    const cfg = time(60_000);
    const long = Array.from({ length: 300 }, () => 'abcde');
    let previous = 0;
    for (let n = 100; n <= 260; n++) {
      const entries = opsFrom('abcde '.repeat(10), 151);
      let t = 60 * 151;
      for (let i = 0; i < n; i++) {
        entries.push({ k: 'c', ch: 'x', t });
        t += 151;
        entries.push({ k: 'b', t });
        t += 20;
      }
      const net = replay(cfg, long, entries).score.wpm;
      const cost = diagnose(cfg, long, entries).costWpm;
      expect(net).toBe(12);
      expect(cost, `n=${n}`).toBeGreaterThanOrEqual(previous);
      expect(cost, `n=${n}`).toBeLessThanOrEqual(net);
      previous = cost;
    }
    expect(previous).toBe(12);
  });

  it('never throws and never claims a cost below the minimum', () => {
    fc.assert(
      fc.property(arbRun, ([c, w, o]) => {
        const d = diagnose(c, w, o);
        return d.kind === 'nothing-notable' ? d.costWpm === 0 : d.costWpm >= 1;
      }),
      RUNS,
    );
  });
});

describe('drillWords', () => {
  const list = ['casa', 'mesa', 'tempo', 'coração', 'pessoa', 'nossa', 'essa', 'ação', 'mão'];

  it('uses only real words holding a weak pair, deterministically', () => {
    const a = drillWords(list, ['ss', 'ão'], SEED, 40);
    expect(a).toEqual(drillWords(list, ['ss', 'ão'], SEED, 40));
    expect(a).toHaveLength(40);
    for (const word of a) {
      expect(list).toContain(word);
      expect(word.includes('ss') || word.includes('ão')).toBe(true);
    }
  });

  it('takes the pairs in turn, so a rare pair still appears', () => {
    const a = drillWords(['casa', 'mesa', 'essa', 'nossa', 'pessoa', 'tempo'], ['ss', 'mp'], SEED, 10);
    expect(a.filter((w) => w === 'tempo')).toHaveLength(5);
  });

  it('holds the no-repeat window on a pool barely larger than it', () => {
    fc.assert(
      fc.property(arbSeed, (seed) => {
        const out = drillWords(['ab1', 'ab2', 'ab3', 'ab4'], ['ab'], seed, 500);
        for (let i = 1; i < out.length; i++) {
          for (let j = Math.max(0, i - 3); j < i; j++) if (out[i] === out[j]) return false;
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });

  it('holds the window across pools that each have room for it', () => {
    const pools = ['ab1', 'ab2', 'ab3', 'ab4', 'cd1', 'cd2', 'cd3', 'cd4', 'abcd'];
    const out = drillWords(pools, ['ab', 'cd'], SEED, 5000);
    for (let i = 1; i < out.length; i++) {
      for (let j = Math.max(0, i - 3); j < i; j++) expect(out[i]).not.toBe(out[j]);
    }
  });

  it('repeats only when a pool cannot avoid it', () => {
    expect(drillWords(['solo'], ['so'], SEED, 3)).toEqual(['solo', 'solo', 'solo']);
  });

  it('rejects a bad seed whatever the list holds', () => {
    expect(() => drillWords(list, ['zz'], 'nope', 3)).toThrow(RangeError);
    expect(() => drillWords(list, [], 'nope', 3)).toThrow(RangeError);
    expect(() => drillWords(list, ['ss'], 'nope', 3)).toThrow(RangeError);
  });

  it('returns nothing when no word holds the pairs', () => {
    expect(drillWords(list, ['zz'], SEED, 10)).toEqual([]);
    expect(drillWords(list, [], SEED, 10)).toEqual([]);
  });
});

describe('paceOf', () => {
  it('interpolates at 0.8·(n−1)', () => {
    expect(paceOf([])).toBeNull();
    expect(paceOf([7000])).toBe(7000);
    const runs = Array.from({ length: 25 }, (_, i) => 5000 + i * 100);
    expect(paceOf([...runs].reverse())).toBeCloseTo(5000 + 19.2 * 100, 6);
  });

  it('matches values computed by Postgres percentile_cont(0.8)', () => {
    for (const [values, expected] of POSTGRES_CASES) expect(paceOf(values)).toBe(expected);
  });
});

describe('percentileOf', () => {
  it('reproduces the published summary', () => {
    // Right-skewed: the mean sits above the median, and 100 WPM is about the top 2%, not the 1% a normal curve claims.
    expect(percentileOf(51.56)).toBe(54);
    expect(percentileOf(26)).toBe(9);
    expect(percentileOf(78)).toBe(89);
    expect(percentileOf(100)).toBe(98);
  });

  it('stays within 1..99 and never decreases', () => {
    expect(percentileOf(0)).toBe(1);
    expect(percentileOf(400)).toBe(99);
    fc.assert(
      fc.property(fc.double({ min: 0, max: 400, noNaN: true }), fc.double({ min: 0, max: 400, noNaN: true }), (a, b) => {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        return percentileOf(lo) <= percentileOf(hi);
      }),
      RUNS,
    );
  });
});

describe('wpmAtPercentile', () => {
  it('gives the benchmark rows the same curve as the sentences', () => {
    expect(wpmAtPercentile(90)).toBe(79);
    expect(wpmAtPercentile(98)).toBe(99);
    for (const percent of [90, 98]) expect(percentileOf(wpmAtPercentile(percent))).toBe(percent);
  });
});

describe('nextDecade', () => {
  it('gives the next round ten and an exact distance', () => {
    expect(nextDecade(78.1)).toEqual({ target: 80, distance: 1.9 });
    expect(nextDecade(80)).toEqual({ target: 90, distance: 10 });
    expect(nextDecade(79.99)).toEqual({ target: 80, distance: 0.01 });
    expect(nextDecade(0)).toEqual({ target: 10, distance: 10 });
  });
});

// Output of `percentile_cont(0.8) WITHIN GROUP (ORDER BY x::integer)` on PostgreSQL 18.6 (PGlite 0.5.15).
const POSTGRES_CASES: readonly (readonly [readonly number[], number])[] = [
  [[5000], 5000],
  [[5000, 6000], 5800],
  [[8000, 7000, 6000], 7600],
  [[1, 2, 3, 4], 3.4000000000000004],
  [[1, 2, 3, 4, 5], 4.2],
  [[100, 100, 100, 101], 100.4],
  [[18254, 9423, 12572, 5573, 20826, 12459, 4840, 17441, 10310, 15815], 17603.6],
  [[12244, 18845, 8082, 13571, 12928, 10585, 18494, 10175, 12780, 21589, 19210], 18845],
  [[10075, 9304, 19953, 14358, 18455, 6404, 13645, 4002, 9075, 14000, 11753, 2382], 14286.4],
  [[12783, 13756, 10437, 3962, 11755, 4456, 8929, 20422, 20199, 10324, 21757, 9650, 9667], 17621.80000000001],
  [[11360, 14041, 14078, 19327, 6156, 20757, 6282, 14875, 15320, 2353, 15286, 9271, 5028, 21005, 20290, 19923, 10032], 19803.8],
  [[21097, 11310, 8079, 7964, 16197, 15770, 20587, 6280, 17057, 3366, 8839, 17588, 11965, 11890, 21411, 4064, 14105, 17278, 21823, 5452, 3605, 8554, 18363, 16632], 17898],
  [[18801, 11318, 12375, 9124, 18861, 7362, 2643, 4528, 5385, 19598, 8623, 17660, 13925, 17306, 3243, 3176, 21281, 10758, 17383, 6836, 12349, 8466, 16323, 9664, 13881], 17438.4],
  [[4094, 17439, 17356, 3093, 21258, 7675, 3064, 21617, 20982, 15351, 12004, 6637, 16642, 18483, 9360, 6057, 8334, 11599, 10108, 14821, 21626, 18763, 3688, 8545, 6278], 18539],
  [[16295, 17428, 18749, 12210, 5731, 11520, 16793, 18942, 17119, 20652, 6901, 6218, 17403, 18232, 3313, 9462, 13303, 2724, 7533, 2498, 14387, 3024, 2985, 14318, 18063], 17555],
  [[17372, 13989, 15674, 20939, 4744, 13281, 18374, 21671, 9876, 7261, 2674, 8547, 19616, 20921, 7358, 15679, 2444, 13909, 4554, 16891, 10616, 16593, 12118, 14263, 9604, 17709, 9538, 15699, 16048, 5289, 2766, 12943, 14428, 15845, 20282, 12907, 20840, 12001, 12966, 9831, 18548, 5053, 20466, 7491, 8672, 4665, 10590, 4511, 16524, 17717], 17710.6],
  [[5866, 6715, 2488, 10833, 9078, 13783, 9412, 20877, 12610, 6163, 18288, 15113, 20014, 10447, 21052, 8709, 13690, 12555, 20264, 21409, 2630, 11911, 18964, 19549, 3730, 3683, 7328, 10265, 11006, 11583, 12300, 8533, 4458, 13019, 19096, 21009, 7126, 20343, 5476, 19117, 9506, 2515, 18928, 5737, 20814, 3247, 14524, 21029, 4506, 7115, 14280, 20289, 10118, 17383, 13204, 5725, 13554, 3939, 14368, 16505, 12094, 16031, 16684, 20469, 8522, 18587, 8664, 18769, 3222, 2647, 16868, 20173, 8258, 18003, 19184, 12393, 8334, 5999, 15036, 14341, 4154, 18571, 4424, 7617, 10246, 12423, 4500, 2333, 13970, 20771, 2496, 2489, 5758, 13567, 21388, 9653, 12842, 2843, 20504, 8657], 18935.2],
];
