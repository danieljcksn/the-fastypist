import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Config } from '@/engine/core';
import { replay } from '@/engine/replay';
import { MAX_CX, SCORER_VERSION, accuracyBp, rawCx, wpmCx } from '@/engine/score';
import { RUNS, WORDS_CFG, arbWords, opsFrom } from './arbitraries';

const time = (durationMs: number): Config => ({ ...WORDS_CFG, mode: 'time', durationMs });

describe('worked examples from scoring.md', () => {
  // The report prints accuracy 79.3 and final-text 74.2. Those count the space after "tempoo" as wrong ("correct only at
  // the word-end slot"), while engine.md section 4, which the brief makes binding, says "Correct key if len >= target".
  // Everything else reproduces. If section 4 is ever overruled, these two become 7931 and 7419.
  it('reproduces the every-rule example at T=6 s, under the section 4 space rule', () => {
    const r = replay(time(6000), ['casa', 'não', 'você', 'tempo', 'coração', 'mesa'], opsFrom('casa nao vp<océ<ê tempoo cor me', 50));
    expect(r.valid).toBe(true);
    expect(r.score.scoredChars).toBe(12);
    expect(r.score.wpm).toBe(24);
    expect(r.score.rawWpm).toBe(58);
    expect(r.score.correctKeys + r.score.wrongKeys).toBe(29);
    expect(r.score.correctKeys).toBe(24);
    expect(r.score.wrongKeys).toBe(5);
    expect(r.score.accuracyBp).toBe(8276);
    expect(r.score.finalTextBp).toBe(7742);
  });

  // The report prints 970 correct and 97.0: it counts six re-presses of an already right slot. A slot now earns one correct
  // key, so those six stay in raw and leave accuracy. Raw, net and final-text reproduce unchanged.
  it('reproduces the realistic example at T=60 s, under the one-key-per-slot rule', () => {
    const words: string[] = [];
    for (let i = 0; i < 157; i++) words.push('abcde');
    for (let i = 0; i < 4; i++) words.push('abcdef');
    words.push('filler');
    const deleted = 'x<'.repeat(24) + 'a<'.repeat(6);
    const keys = deleted + 'abcde '.repeat(157) + 'xbxdef ' + 'axcxef ' + 'abcxef ' + 'abxdef ';
    const r = replay(time(60_000), words, opsFrom(keys, 50));
    expect(r.valid).toBe(true);
    expect(r.score.correctKeys).toBe(964);
    expect(r.score.repeatKeys).toBe(6);
    expect(r.score.wrongKeys).toBe(30);
    expect(r.score.scoredChars).toBe(942);
    expect(r.score.wpm).toBe(188.4);
    expect(r.score.rawWpm).toBe(200);
    expect(r.score.accuracy).toBe(96.98);
    expect(r.score.finalTextAccuracy).toBe(99.38);
  });
});

describe('net and raw', () => {
  it('a wrong word earns nothing, even when it has a correct prefix', () => {
    const r = replay(time(60_000), ['abc', 'def'], opsFrom('ab '));
    expect(r.score.scoredChars).toBe(0);
  });

  it('credits a correct prefix of the unfinished word, with no space', () => {
    const r = replay(time(60_000), ['abc', 'defgh', 'x'], opsFrom('abc de'));
    expect(r.score.scoredChars).toBe(6);
  });

  it('gives nothing for an unfinished word with any wrong or extra letter', () => {
    expect(replay(time(60_000), ['abc', 'x'], opsFrom('axc')).score.scoredChars).toBe(0);
    expect(replay(time(60_000), ['abc', 'x'], opsFrom('abcd')).score.scoredChars).toBe(0);
  });

  it('the last word earns no trailing space, and T ends at the last character', () => {
    const r = replay(WORDS_CFG, ['abc', 'def'], opsFrom('abc def', 100));
    expect(r.score.scoredChars).toBe(6);
    expect(r.score.elapsedMs).toBe(600);
    expect(r.score.wpmCx).toBe(Math.round((1_200_000 * 6) / 600));
  });

  it('words mode credits Cw−1, which is MacKenzie\'s 2.3% on his own sentence', () => {
    const sentence = 'the quick brown fox jumps over the lazy dog';
    const r = replay(WORDS_CFG, sentence.split(' '), opsFrom(sentence, 100));
    expect(sentence).toHaveLength(43);
    expect(r.score.elapsedMs).toBe(4200);
    expect(r.score.scoredChars).toBe(42);
    expect(r.score.wpm).toBe(120);
    expect(replay(WORDS_CFG, ['ab', 'cd'], opsFrom('ab cd')).score.scoredChars).toBe(4);
  });

  it('a metronome scores its own speed in words mode, whatever the length of the text', () => {
    fc.assert(
      fc.property(arbWords, fc.constantFrom(50, 100, 150, 200), (words, gap) => {
        const text = words.join(' ');
        if (text.length < 2) return true;
        return replay(WORDS_CFG, words, opsFrom(text, gap)).score.wpmCx === Math.round(1_200_000 / gap);
      }),
      RUNS,
    );
  });

  it('time mode keeps all of Cw, because its T is the mode\'s and not first key to last', () => {
    const r = replay(time(1000), ['ab', 'cd'], opsFrom('ab cd', 100));
    expect(r.score.scoredChars).toBe(5);
    expect(r.score.wpmCx).toBe(6000);
  });

  it('words mode never credits below zero', () => {
    const r = replay(WORDS_CFG, ['ab'], opsFrom('x ', 100));
    expect(r.valid).toBe(true);
    expect(r.score.scoredChars).toBe(0);
    expect(r.score.wpmCx).toBe(0);
  });

  it('a correction earns its word back, but accuracy remembers the error', () => {
    const r = replay(WORDS_CFG, ['abc', 'def'], opsFrom('axc<<bc def'));
    expect(r.score.scoredChars).toBe(6);
    expect(r.score.wrongKeys).toBe(1);
    expect(r.score.accuracy).toBeLessThan(100);
    expect(r.score.finalTextAccuracy).toBe(100);
  });

  it('raw counts deleted insertions', () => {
    const r = replay(time(60_000), ['abc', 'x'], opsFrom('axx<<bc '));
    expect(r.score.correctKeys + r.score.wrongKeys).toBe(6);
    expect(r.score.rawCx).toBe(rawCx(6, 60_000));
  });

  it('does not count dead keys as insertions or errors', () => {
    const r = replay(WORDS_CFG, ['não'], opsFrom('n`ão'));
    expect(r.score.accuracyBp).toBe(10_000);
    expect(r.score.deadKeys).toBe(1);
    expect(r.score.rawCx).toBe(rawCx(3, 300));
  });

  it('a one-key run has T=0 and scores 0 instead of dividing by it', () => {
    const r = replay(WORDS_CFG, ['a'], opsFrom('a'));
    expect(r.valid).toBe(true);
    expect(r.score.wpm).toBe(0);
    expect(r.score.accuracy).toBe(100);
  });
});

describe('integer forms', () => {
  it('wpmCx and rawCx are 12·C/T in centi-WPM', () => {
    expect(wpmCx(300, 60_000)).toBe(6000);
    expect(rawCx(1000, 60_000)).toBe(20_000);
    expect(wpmCx(5, 0)).toBe(0);
  });

  it('holds wpmCx and rawCx to the integer column', () => {
    expect(MAX_CX).toBe(2 ** 31 - 1);
    expect(wpmCx(65_536, 1)).toBe(MAX_CX);
    expect(rawCx(65_536, 1)).toBe(MAX_CX);
  });

  it('exports the scorer version that tickets and results carry', () => {
    expect(SCORER_VERSION).toBe(1);
  });

  it('a perfect run is exactly 100 and 10000', () => {
    expect(accuracyBp(1, 0)).toBe(10_000);
    expect(accuracyBp(3333, 0)).toBe(10_000);
    const r = replay(WORDS_CFG, ['abc', 'def'], opsFrom('abc def'));
    expect(r.score.accuracy).toBe(100);
    expect(r.score.accuracyBp).toBe(10_000);
  });

  it('never rounds an imperfect run up to a perfect one', () => {
    expect(accuracyBp(99_999, 1)).toBe(9_999);
    expect(accuracyBp(0, 0)).toBe(0);
    expect(accuracyBp(0, 5)).toBe(0);
  });
});
