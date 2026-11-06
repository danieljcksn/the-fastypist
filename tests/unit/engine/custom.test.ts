import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type LogEntry, MAX_OPS, WORDS_MAX_ELAPSED_MS, expire, init, step } from '@/engine/core';
import { CUSTOM_MAX_CHARS, parseCustomText } from '@/engine/custom';
import { decodeLog, encodeLog } from '@/engine/log';
import { replay } from '@/engine/replay';
import { RUNS, WORDS_CFG } from './arbitraries';

const GAP_AT_20_WPM = 600;

function perfectRun(words: readonly string[]): LogEntry[] {
  const entries: LogEntry[] = [];
  let t = 0;
  words.forEach((word, i) => {
    if (i > 0) {
      entries.push({ k: 's', t });
      t += GAP_AT_20_WPM;
    }
    for (let j = 0; j < word.length; j++) {
      entries.push({ k: 'c', ch: word.charAt(j), t });
      t += GAP_AT_20_WPM;
    }
  });
  return entries;
}

describe('parseCustomText', () => {
  it('splits on any whitespace', () => {
    expect(parseCustomText('  um dois\n\ttrês quatro\r\n')).toEqual({ ok: true, words: ['um', 'dois', 'três', 'quatro'] });
  });

  it('composes decomposed letters, so one letter stays one unit', () => {
    expect(parseCustomText('não você')).toEqual({ ok: true, words: ['não', 'você'] });
  });

  it('folds typographic punctuation to what a keyboard types', () => {
    expect(parseCustomText('don’t “go” a—b wait…')).toEqual({ ok: true, words: ["don't", '"go"', 'a-b', 'wait...'] });
  });

  it('drops characters nobody can see', () => {
    expect(parseCustomText('﻿ab​cd­ ef')).toEqual({ ok: true, words: ['abcd', 'ef'] });
  });

  it('refuses an empty text', () => {
    for (const blank of ['', '   ', '\n\t', '​']) expect(parseCustomText(blank)).toEqual({ ok: false, reason: 'empty' });
  });

  it('refuses emoji and names the first one', () => {
    expect(parseCustomText('ola 😀 mundo 🎉')).toEqual({ ok: false, reason: 'untypable', char: '😀' });
    expect(parseCustomText('𝒜')).toEqual({ ok: false, reason: 'untypable', char: '𝒜' });
  });

  it('refuses control characters, lone surrogates and marks that will not compose', () => {
    expect(parseCustomText('a\u0007b')).toEqual({ ok: false, reason: 'untypable', char: '\u0007' });
    expect(parseCustomText('a\ud83db')).toEqual({ ok: false, reason: 'untypable', char: '\ud83d' });
    expect(parseCustomText('x̃')).toEqual({ ok: false, reason: 'untypable', char: '̃' });
    expect(parseCustomText('')).toEqual({ ok: false, reason: 'untypable', char: '' });
  });

  it('refuses text past the limit, counting the spaces', () => {
    const fits = 'ab '.repeat(CUSTOM_MAX_CHARS / 3).trim();
    expect(fits.length).toBeLessThanOrEqual(CUSTOM_MAX_CHARS);
    expect(parseCustomText(fits).ok).toBe(true);
    const over = 'a'.repeat(CUSTOM_MAX_CHARS + 1);
    expect(parseCustomText(over)).toEqual({ ok: false, reason: 'too-long', chars: CUSTOM_MAX_CHARS + 1 });
  });

  it('refuses the texts that used to fail only after the run', () => {
    expect(parseCustomText('abcd '.repeat(1500))).toMatchObject({ ok: false, reason: 'too-long' });
    expect(parseCustomText('abcde '.repeat(12_000))).toMatchObject({ ok: false, reason: 'too-long' });
  });

  it('keeps the longest text inside replay\'s limits for anyone at 20 WPM', () => {
    const parsed = parseCustomText('abcd '.repeat(CUSTOM_MAX_CHARS / 5).trim());
    if (!parsed.ok) throw new Error(parsed.reason);
    const entries = perfectRun(parsed.words);
    expect(entries.at(-1)?.t).toBeLessThanOrEqual(WORDS_MAX_ELAPSED_MS);
    // Room for 30 presses per character, far past any honest amount of correcting.
    expect(entries.length * 30).toBeLessThan(MAX_OPS);
    const r = replay(WORDS_CFG, parsed.words, entries);
    expect(r.valid).toBe(true);
    expect(r.score.accuracyBp).toBe(10_000);
  });

  it('whatever it accepts, a run on it finishes, replays and round-trips the log', () => {
    const plain = fc.constantFrom(...'abc ãéç\n\t.,’“”—…', 'a\u0303', '\u200d', '\u00ad');
    const poison = fc.oneof(
      fc.constantFrom('😀', '\u0301', '\ud83d', '\u0000', '\u0085', '\ue000'),
      fc.string({ unit: 'binary', minLength: 1, maxLength: 1 }),
    );
    let accepted = 0;
    let refused = 0;
    fc.assert(
      fc.property(fc.array(plain, { maxLength: 40, size: 'max' }), fc.boolean(), poison, fc.nat(), (parts, poisoned, bad, at) => {
        if (poisoned) parts.splice(at % (parts.length + 1), 0, bad);
        const parsed = parseCustomText(parts.join(''));
        if (!parsed.ok) {
          refused++;
          return true;
        }
        accepted++;
        const entries = perfectRun(parsed.words);
        const live = init();
        for (const entry of entries) step(WORDS_CFG, parsed.words, live, entry);
        expire(WORDS_CFG, live);
        expect(live.phase).toBe('finished');
        const r = replay(WORDS_CFG, parsed.words, entries);
        expect(r.valid).toBe(true);
        expect(JSON.stringify(r.state)).toBe(JSON.stringify(live));
        expect(decodeLog(encodeLog(entries))).toEqual(entries);
        return true;
      }),
      RUNS,
    );
    expect(accepted).toBeGreaterThan(100);
    expect(refused).toBeGreaterThan(100);
  });
});
