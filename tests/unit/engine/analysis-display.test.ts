import { describe, expect, it } from 'vitest';
import {
  charProgress,
  creditTimes,
  currentPace,
  curveAt,
  drillChange,
  drillTargets,
  mistakes,
  monthInsight,
  movingAverage,
  offsetAt,
  paceSeries,
  paceTrend,
  pairsAcrossRuns,
  rhythmTier,
  secondSpeeds,
  speedCurve,
  speedFinding,
  speedSeries,
  type SpeedPoint,
} from '@/engine/analysis';
import type { Config, LogEntry } from '@/engine/core';
import { WORDS_CFG, opsFrom } from './arbitraries';

const time = (durationMs: number): Config => ({ ...WORDS_CFG, mode: 'time', durationMs, maxExtra: 4 });
const DAY = 86_400_000;

function timedKeys(keys: string, gap: (i: number, ch: string, prev: string) => number): LogEntry[] {
  const out: LogEntry[] = opsFrom(keys, 0);
  let t = 0;
  out.forEach((e, i) => {
    if (i > 0) t += gap(i, keys.charAt(i), keys.charAt(i - 1));
    e.t = t;
  });
  return out;
}

describe('secondSpeeds', () => {
  const point = (second: number, credited: number): SpeedPoint => ({ second, raw: 0, net: 0, errors: 0, credited });

  it('turns each second\'s credited letters into wpm, 1 letter a second being 12', () => {
    expect(secondSpeeds([point(1, 6), point(2, 13), point(3, 19)], 3000)).toEqual([72, 84, 72]);
  });

  it('reads a second that lost credit as 0, and the next one from where the credit stood', () => {
    expect(secondSpeeds([point(1, 6), point(2, 2), point(3, 8)], 3000)).toEqual([72, 0, 72]);
  });

  it('divides a last part-second by its own length', () => {
    // 3 letters in the 600 ms after second 2 is 60 wpm.
    expect(secondSpeeds([point(1, 6), point(2, 12), point(3, 15)], 2600)).toEqual([72, 72, 60]);
  });

  it('folds a last sliver under half a second into the second before it', () => {
    // Second 2 and the 200 ms after it hold 6 + 2 letters over 1.2 s: 80 wpm, where the sliver alone would claim 120.
    expect(secondSpeeds([point(1, 6), point(2, 12), point(3, 14)], 2200)).toEqual([72, 80]);
  });

  it('agrees with the score: the letters it counts add up to the run\'s credited letters', () => {
    const entries = opsFrom('ab cd ef gh ', 170);
    const series = speedSeries(time(3000), ['ab', 'cd', 'ef', 'gh', 'ij'], entries);
    const speeds = secondSpeeds(series, 3000);
    const letters = speeds.reduce((sum, wpm) => sum + wpm / 12, 0);
    expect(letters).toBeCloseTo(series.at(-1)?.credited ?? -1, 9);
  });

  it('is empty for an empty series', () => {
    expect(secondSpeeds([], 0)).toEqual([]);
  });
});

describe('movingAverage', () => {
  it('narrows at the ends and keeps the length', () => {
    expect(movingAverage([0, 10, 20], 3)).toEqual([5, 10, 15]);
    expect(movingAverage([], 5)).toEqual([]);
  });

  it('leaves a flat line flat', () => {
    expect(movingAverage(Array(9).fill(40) as number[])).toEqual(Array(9).fill(40));
  });
});

describe('speedCurve', () => {
  // One credited letter every 100 ms is 10 a second, 120 wpm.
  const steady = (n: number) => Array.from({ length: n }, (_, i) => i * 100);

  it('reads a steady typist as level, sampled every 250 ms from 0 to the end', () => {
    const curve = speedCurve(steady(200), 20_000);
    expect(curve[0]?.ms).toBe(0);
    expect(curve.at(-1)?.ms).toBe(20_000);
    expect(curve.length).toBe(81);
    // Once the window clears both ends.
    for (const c of curve.filter((c) => c.ms >= 2500 && c.ms <= 17_250)) expect(c.wpm).toBeCloseTo(120, 6);
  });

  it('fades one letter in and out rather than stepping the line', () => {
    const base = speedCurve(steady(200), 20_000);
    const more = speedCurve([...steady(200), 10_050].sort((a, b) => a - b), 20_000);
    const lift = more.map((c, i) => c.wpm - (base[i]?.wpm ?? 0));
    // One letter at the window's centre is worth 12000 / 2500 = 4.8 wpm, and less the further it is.
    expect(Math.max(...lift)).toBeLessThanOrEqual(4.8 + 1e-9);
    expect(lift[40]).toBeCloseTo(4.8 * (1 - 50 / 2500), 6);
    expect(lift.filter((v, i) => Math.abs(i * 250 - 10_050) >= 2500).every((v) => Math.abs(v) < 1e-9)).toBe(true);
  });

  it('has nothing to say about a run with no time', () => {
    expect(speedCurve([], 0)).toEqual([]);
  });

  it('interpolates between samples', () => {
    const curve = [
      { ms: 0, wpm: 60 },
      { ms: 250, wpm: 70 },
    ];
    expect(curveAt(curve, 125)).toBe(65);
    expect(curveAt(curve, 900)).toBe(70);
  });
});

describe('creditTimes', () => {
  const cfg = time(60_000);
  it('times each credited letter and space by the key that last typed it', () => {
    expect(creditTimes(cfg, ['the', 'cat', 'sat'], opsFrom('the cat ', 100))).toEqual([0, 100, 200, 300, 400, 500, 600, 700]);
  });

  it('credits a fixed typo at the fix, and nothing in between', () => {
    // t h x < e space: "e" is credited when it was typed, after the backspace.
    expect(creditTimes(cfg, ['the', 'cat'], opsFrom('thx<e ', 100))).toEqual([0, 100, 400, 500]);
  });

  it('leaves out a word that stayed wrong, and keeps a correct start of the last', () => {
    expect(creditTimes(cfg, ['the', 'cat', 'sat'], opsFrom('thy ca', 100))).toEqual([400, 500]);
  });
});

describe('speedFinding', () => {
  const flat = (n: number, v: number) => Array.from({ length: n }, () => v);

  it('finds the second a run slowed and by how much', () => {
    const line = [...flat(41, 90), ...flat(19, 76)];
    expect(speedFinding(line)).toEqual({ kind: 'slowed', second: 41, wpm: 14 });
  });

  it('finds a speed-up', () => {
    expect(speedFinding([...flat(12, 50), ...flat(48, 60)])).toEqual({ kind: 'sped-up', second: 12, wpm: 10 });
  });

  it('says steady when there is no step and the line is narrow', () => {
    expect(speedFinding(flat(60, 80))).toEqual({ kind: 'steady', spread: 0 });
  });

  it('says nothing about a short run or an all-zero one', () => {
    expect(speedFinding(flat(19, 80))).toBeNull();
    expect(speedFinding(flat(60, 0))).toBeNull();
  });

  it('says nothing when the line is noisy with no single step', () => {
    const noisy = Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? 40 : 90));
    expect(speedFinding(noisy)).toBeNull();
  });

  it('reads a sprint in the last seconds of a long run as no step at all', () => {
    // 115 s at 70 then 5 s at 85: before, this read "slower for the first 115 seconds".
    expect(speedFinding([...flat(115, 70), ...flat(5, 85)])?.kind).not.toBe('sped-up');
  });

  it('calls a slow stretch with the speed back after it a dip, not a slower run', () => {
    expect(speedFinding([...flat(30, 76), ...flat(15, 50), ...flat(15, 76)])).toEqual({ kind: 'dipped', from: 31, to: 45 });
    // 76 wpm, down to 41 by second 37, back to 76 by second 50, as the 5 s average the chart draws.
    const raw = Array.from({ length: 60 }, (_, i) => (i < 33 ? 76 : i < 37 ? 76 - (i - 32) * 8.75 : i < 46 ? 41 : i < 50 ? 41 + (i - 45) * 8.75 : 76));
    const finding = speedFinding(movingAverage(raw));
    expect(finding?.kind).toBe('dipped');
    if (finding?.kind !== 'dipped') return;
    expect(finding.from).toBeGreaterThanOrEqual(33);
    expect(finding.to).toBeLessThanOrEqual(49);
  });

  it('keeps a slump that never comes back a step', () => {
    expect(speedFinding([...flat(30, 76), ...flat(15, 50), ...flat(15, 54)])?.kind).toBe('slowed');
  });

  it('holds its minimum on a step just under 6 wpm', () => {
    expect(speedFinding([...flat(30, 30), ...flat(30, 25)])?.kind).toBe('steady');
  });
});

describe('mistakes', () => {
  const cfg = { ...WORDS_CFG, maxExtra: 4 };

  it('tells wrong, extra and missed apart', () => {
    // "xb" one wrong letter; "cdzz" two extras; "e " three letters missed by one space.
    const result = mistakes(cfg, ['ab', 'cd', 'efgh', 'i'], opsFrom('xb cdzz e i', 10));
    expect(result).toMatchObject({ wrong: 1, extra: 2, missed: 3 });
    expect(result.at).toHaveLength(4);
  });

  it('counts a corrected mistake, since it cost the time', () => {
    const entries: LogEntry[] = [
      { k: 'c', ch: 'x', t: 0 },
      { k: 'b', t: 100 },
      { k: 'c', ch: 'a', t: 200 },
    ];
    expect(mistakes(cfg, ['a'], entries)).toEqual({ wrong: 1, extra: 0, missed: 0, at: [0] });
  });

  it('counts a press past the extra cap as extra, so the ticks match accuracy', () => {
    expect(mistakes({ ...cfg, maxExtra: 1 }, ['a', 'b'], opsFrom('azzz b', 10))).toMatchObject({ wrong: 0, extra: 3, missed: 0 });
  });

  it('ignores keys after the buzzer', () => {
    const entries: LogEntry[] = [
      { k: 'c', ch: 'a', t: 0 },
      { k: 'c', ch: 'z', t: 2000 },
    ];
    expect(mistakes(time(1000), ['ab'], entries).at).toEqual([]);
  });

  it('is empty for a clean run', () => {
    expect(mistakes(cfg, ['ab'], opsFrom('ab', 10))).toEqual({ wrong: 0, extra: 0, missed: 0, at: [] });
  });
});

describe('rhythmTier', () => {
  it('cuts at 0.95, 0.77 and 0.6 of the run', () => {
    expect(rhythmTier(95, 100)).toBe(0);
    expect(rhythmTier(94.9, 100)).toBe(1);
    expect(rhythmTier(77, 100)).toBe(1);
    expect(rhythmTier(76.9, 100)).toBe(2);
    expect(rhythmTier(60, 100)).toBe(2);
    expect(rhythmTier(59.9, 100)).toBe(3);
  });

  it('puts everything at speed when the run scored zero', () => {
    expect(rhythmTier(0, 0)).toBe(0);
  });
});

describe('drillTargets', () => {
  const word = 'the then';

  it('takes the pairs the diagnosis names', () => {
    const text = Array.from({ length: 12 }, () => word).join(' ');
    const entries = timedKeys(text, (_, ch, prev) => (prev === 't' && ch === 'h' ? 300 : 80));
    expect(drillTargets(WORDS_CFG, text.split(' '), entries)).toEqual(['th']);
  });

  it('falls back to visibly slow pairs under the diagnosis thresholds, at most two', () => {
    const text = 'the the the and and and';
    const entries = timedKeys(text, (_, ch, prev) => (prev === 't' && ch === 'h' ? 200 : prev === 'a' && ch === 'n' ? 160 : 80));
    expect(drillTargets(WORDS_CFG, text.split(' '), entries)).toEqual(['th', 'an']);
  });

  it('offers nothing with too little to go on', () => {
    expect(drillTargets(WORDS_CFG, ['ab'], opsFrom('ab', 100))).toEqual([]);
    expect(drillTargets(WORDS_CFG, ['ab'], [])).toEqual([]);
  });

  it('skips a pair with punctuation in it and lower-cases the rest', () => {
    const text = `Th. Th. Th. Th. Th. Th. ${Array.from({ length: 30 }, () => 'ok').join(' ')}`;
    const entries = timedKeys(text, (_, ch) => (ch === 'h' || ch === '.' ? 300 : 80));
    const targets = drillTargets(WORDS_CFG, text.split(' '), entries);
    expect(targets).toContain('th');
    expect(targets).not.toContain('h.');
  });
});

describe('pairsAcrossRuns', () => {
  const run = (slow: number) => {
    const text = 'the the the the the the and and and and and and';
    return { cfg: WORDS_CFG, words: text.split(' '), entries: timedKeys(text, (_, ch, prev) => (prev === 't' && ch === 'h' ? slow : 100)) };
  };

  it('weights the mean by count and averages the cost per run', () => {
    const pairs = pairsAcrossRuns([run(300), run(100)]);
    const th = pairs.find((p) => p.pair === 'th');
    expect(th?.count).toBe(12);
    expect(th?.meanMs).toBe(200);
    expect(pairs[0]?.pair).toBe('th');
  });

  it('drops pairs with too few samples and handles no runs', () => {
    const short = 'the and';
    const log = { cfg: WORDS_CFG, words: short.split(' '), entries: opsFrom(short, 100) };
    expect(pairsAcrossRuns([log])).toEqual([]);
    expect(pairsAcrossRuns([])).toEqual([]);
  });
});

describe('drillChange', () => {
  const before = { th: { meanMs: 200, count: 20 }, qu: { meanMs: 150, count: 20 }, ck: { meanMs: 150, count: 2 }, ão: { meanMs: 150, count: 20 } };

  it('reads faster, slower, same and unknown', () => {
    const now = [
      { pair: 'th', count: 9, meanMs: 150, costWpm: 0 },
      { pair: 'qu', count: 9, meanMs: 152, costWpm: 0 },
      { pair: 'ck', count: 9, meanMs: 100, costWpm: 0 },
    ];
    expect(drillChange(before, now).map((c) => c.verdict)).toEqual(['faster', 'same', 'unknown', 'unknown']);
    expect(drillChange(before, now).at(-1)?.nowMs).toBeNull();
  });

  it('calls a slower pair slower', () => {
    expect(drillChange({ th: { meanMs: 100, count: 9 } }, [{ pair: 'th', count: 9, meanMs: 150, costWpm: 0 }])[0]?.verdict).toBe('slower');
  });

  it('holds a change under 10 ms as the same, even above 10%', () => {
    expect(drillChange({ th: { meanMs: 50, count: 9 } }, [{ pair: 'th', count: 9, meanMs: 42, costWpm: 0 }])[0]?.verdict).toBe('same');
  });

  it('needs enough samples in the drill as well', () => {
    expect(drillChange({ th: { meanMs: 200, count: 9 } }, [{ pair: 'th', count: 4, meanMs: 100, costWpm: 0 }])[0]?.verdict).toBe('unknown');
  });
});

describe('charProgress and offsetAt', () => {
  it('counts characters reached per second, space included', () => {
    const entries = timedKeys('ab cd', () => 500);
    // a 0 ms, b 500, space 1000, c 1500, d 2000.
    expect(charProgress(WORDS_CFG, ['ab', 'cd'], entries)).toEqual([0, 2, 4, 5]);
  });

  it('caps a word at its length, so extras never run the caret ahead', () => {
    expect(charProgress({ ...WORDS_CFG, maxExtra: 4 }, ['a', 'b'], opsFrom('azzz b', 1)).at(-1)).toBe(3);
  });

  it('follows a return to an earlier word', () => {
    const entries: LogEntry[] = [
      { k: 'c', ch: 'x', t: 0 },
      { k: 's', t: 100 },
      { k: 'b', t: 200 },
    ];
    expect(charProgress(WORDS_CFG, ['ab', 'cd'], entries).at(-1)).toBe(1);
  });

  it('is empty before the first letter', () => {
    expect(charProgress(WORDS_CFG, ['ab'], [])).toEqual([]);
  });

  it('interpolates and waits past the end', () => {
    expect(offsetAt([0, 10, 30], 1.5)).toBe(20);
    expect(offsetAt([0, 10, 30], 0)).toBe(0);
    expect(offsetAt([0, 10, 30], 9)).toBe(30);
    expect(offsetAt([], 3)).toBe(0);
  });
});

describe('Pace over history', () => {
  const now = 1_800_000_000_000;
  const runs = (n: number, wpm: (i: number) => number, spanDays = n) =>
    Array.from({ length: n }, (_, i) => ({ t: now - ((n - 1 - i) / Math.max(1, n - 1)) * spanDays * DAY, wpmCx: Math.round(wpm(i) * 100) }));

  it('is null under 10 runs and the 80th percentile from there', () => {
    expect(currentPace(runs(9, () => 70), now)).toBeNull();
    expect(currentPace(runs(10, (i) => 60 + i), now)).toBeCloseTo(60 + 0.8 * 9, 6);
  });

  it('uses only the last 25 runs', () => {
    const older = runs(50, (i) => (i < 25 ? 200 : 60), 40);
    expect(currentPace(older, now)).toBe(60);
  });

  it('forgets runs older than 90 days', () => {
    const stale = [...runs(20, () => 90, 10).map((r) => ({ ...r, t: r.t - 100 * DAY })), ...runs(5, () => 60, 5)];
    expect(currentPace(stale, now)).toBeNull();
  });

  it('starts its line at the tenth run', () => {
    const series = paceSeries(runs(12, () => 70));
    expect(series).toHaveLength(3);
    expect(series[0]?.pace).toBe(70);
  });

  it('claims a trend only over 21 points and 2 wpm', () => {
    const series = (n: number, step: number) => Array.from({ length: n }, (_, i) => ({ t: i, pace: 70 + i * step }));
    expect(paceTrend(series(20, 1))).toBeNull();
    expect(paceTrend(series(21, 1))).toEqual({ wpm: 20, since: 0 });
    expect(paceTrend(series(21, 0.01))).toBeNull();
    expect(paceTrend([])).toBeNull();
  });
});

describe('monthInsight', () => {
  const now = 1_800_000_000_000;
  const spaced = (n: number, fromDays: number, wpm: (i: number) => number) =>
    Array.from({ length: n }, (_, i) => ({ t: now - (fromDays - (i * 25) / n) * DAY, wpmCx: Math.round(wpm(i) * 100) }));
  const wiggle = (i: number) => (i % 2 === 0 ? 1 : -1);

  it('says nothing under 10 runs on either side', () => {
    expect(monthInsight([...spaced(10, 28, () => 70), ...spaced(9, 58, () => 60)], now)).toBeNull();
    expect(monthInsight([...spaced(9, 28, () => 70), ...spaced(10, 58, () => 60)], now)).toBeNull();
  });

  it('claims a clear move with its size', () => {
    expect(monthInsight([...spaced(20, 28, (i) => 80 + wiggle(i)), ...spaced(20, 58, (i) => 70 + wiggle(i))], now)).toEqual({ kind: 'up', wpm: 10 });
    expect(monthInsight([...spaced(20, 28, (i) => 60 + wiggle(i)), ...spaced(20, 58, (i) => 70 + wiggle(i))], now)).toEqual({ kind: 'down', wpm: 10 });
  });

  it('calls a move under 2 wpm the same', () => {
    expect(monthInsight([...spaced(20, 28, () => 71), ...spaced(20, 58, () => 70)], now)).toEqual({ kind: 'same' });
  });

  it('calls a move inside the noise the same', () => {
    const noisy = (centre: number) => (i: number) => centre + wiggle(i) * 30;
    expect(monthInsight([...spaced(10, 28, noisy(75)), ...spaced(10, 58, noisy(70))], now)).toEqual({ kind: 'same' });
  });
});
