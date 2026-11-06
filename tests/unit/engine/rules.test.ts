import { describe, expect, it } from 'vitest';
import { type Config, MAX_EXTRA, WORDS_MAX_ELAPSED_MS, MAX_OPS, type Op, expiresAt, init, letterStatus, step } from '@/engine/core';
import { replay } from '@/engine/replay';
import { MAX_CX } from '@/engine/score';
import { WORDS_CFG, opsFrom, run } from './arbitraries';

const TEXT = ['casa', 'não', 'você'];

describe('word rules, engine.md section 4', () => {
  it('space on idle or on an empty word is ignored without penalty', () => {
    const s = run(WORDS_CFG, TEXT, opsFrom('  c<  '));
    expect(s.phase).toBe('running');
    expect(s.w).toBe(0);
    expect(s.wrongKeys).toBe(0);
    expect(s.ignored).toBe(4);
  });

  it('caps extras at 8 but still counts each key as wrong', () => {
    const s = run(WORDS_CFG, TEXT, opsFrom('casa' + 'x'.repeat(12)));
    expect(MAX_EXTRA).toBe(8);
    expect(s.typed[0]).toBe('casa' + 'x'.repeat(8));
    expect(s.wrongKeys).toBe(12);
  });

  it('an early space commits a wrong word, is itself wrong, and leaves letters missed', () => {
    const s = run(WORDS_CFG, TEXT, opsFrom('ca '));
    expect(s.w).toBe(1);
    expect(s.wrongKeys).toBe(1);
    expect(letterStatus(TEXT, s, 0, 2)).toBe('missed');
  });

  it('a space at or past the word end is a correct key even after wrong letters', () => {
    expect(run(WORDS_CFG, TEXT, opsFrom('cxsa ')).correctKeys).toBe(4);
    expect(run(WORDS_CFG, TEXT, opsFrom('casax ')).correctKeys).toBe(5);
  });

  it('backspace returns only to a wrong word, deleting nothing', () => {
    const s = run(WORDS_CFG, TEXT, opsFrom('cxsa <'));
    expect(s.w).toBe(0);
    expect(s.typed).toEqual(['cxsa']);
    const locked = run(WORDS_CFG, TEXT, opsFrom('casa <'));
    expect(locked.w).toBe(1);
    expect(locked.ignored).toBe(1);
  });

  it("backspace 'never' keeps wrong words locked too", () => {
    const cfg: Config = { ...WORDS_CFG, backspace: 'never' };
    expect(run(cfg, TEXT, opsFrom('cxsa <')).w).toBe(1);
  });

  it('word delete clears, then returns and clears a wrong word', () => {
    const s = run(WORDS_CFG, TEXT, opsFrom('cxsa nã^'));
    expect(s.typed).toEqual(['cxsa', '']);
    const back = run(WORDS_CFG, TEXT, opsFrom('cxsa nã^^'));
    expect(back.w).toBe(0);
    expect(back.typed).toEqual(['']);
    expect(run(WORDS_CFG, TEXT, opsFrom('casa ^')).w).toBe(1);
  });

  it('stopOn word holds on a wrong word and counts the space wrong', () => {
    const s = run({ ...WORDS_CFG, stopOn: 'word' }, TEXT, opsFrom('cx '));
    expect(s.w).toBe(0);
    expect(s.wrongKeys).toBe(2);
  });

  it('stopOn letter counts a wrong key but does not append it', () => {
    const s = run({ ...WORDS_CFG, stopOn: 'letter' }, TEXT, opsFrom('cxa'));
    expect(s.typed[0]).toBe('ca');
    expect(s.wrongKeys).toBe(1);
  });

  it('words mode ends when the last word is exactly typed, with no space', () => {
    const s = run(WORDS_CFG, ['ab', 'cd'], opsFrom('ab cd'));
    expect(s.phase).toBe('finished');
    expect(s.endT).toBe(400);
  });

  it('words mode ends when the last word is committed wrong, and that word earns nothing', () => {
    const r = replay(WORDS_CFG, ['ab', 'cdef'], opsFrom('ab cd '));
    expect(r.valid).toBe(true);
    expect(r.state.allCommitted).toBe(true);
    expect(r.score.scoredChars).toBe(2);
    expect(r.score.wordsWrong).toBe(1);
    expect(r.score.chars.missed).toBe(2);
    expect(letterStatus(['ab', 'cdef'], r.state, 1, 3)).toBe('missed');
  });
});

describe('a slot earns one correct key per run', () => {
  const cfg: Config = { ...WORDS_CFG, mode: 'time', durationMs: 60_000 };
  const words = ['ab', 'cd', 'ef'];

  it('re-committing a wrong word buys no accuracy', () => {
    const before = replay(cfg, words, opsFrom('zzzzzzzz ', 10)).score;
    const after = replay(cfg, words, opsFrom('zzzzzzzz ' + '< '.repeat(100), 10)).score;
    expect(before.accuracyBp).toBe(1111);
    expect(after.accuracyBp).toBe(1111);
    expect(after.correctKeys).toBe(1);
    expect(after.repeatKeys).toBe(100);
  });

  it('pressing a right letter and deleting it buys no accuracy, by backspace or by word delete', () => {
    for (const pump of ['a<', 'a^']) {
      const r = replay(cfg, words, opsFrom('zzzzzzzz^' + pump.repeat(100), 10)).score;
      expect(r.correctKeys, pump).toBe(1);
      expect(r.repeatKeys, pump).toBe(99);
      expect(r.accuracyBp, pump).toBe(1111);
    }
  });

  it('raw still counts every press, since raw minus net is the wasted motion', () => {
    const r = replay(cfg, words, opsFrom('zzzzzzzz ' + '< '.repeat(100), 10)).score;
    expect(r.rawCx).toBe(Math.round((1_200_000 * 109) / 60_000));
  });

  it('fixing a wrong letter earns that slot, and only that slot', () => {
    const r = replay(cfg, words, opsFrom('xb<<ab', 10)).score;
    expect(r.correctKeys).toBe(2);
    expect(r.wrongKeys).toBe(1);
    expect(r.repeatKeys).toBe(1);
  });

  it('leaving a word and coming back does not reopen any slot', () => {
    const next = replay(cfg, words, opsFrom('zz ' + 'c^< '.repeat(50), 10)).score;
    expect(next.correctKeys).toBe(2);
    expect(next.repeatKeys).toBe(99);
    const again = replay(cfg, words, opsFrom('zb ' + '<<b '.repeat(50), 10)).score;
    expect(again.correctKeys).toBe(2);
    expect(again.wrongKeys).toBe(1);
    expect(again.repeatKeys).toBe(100);
  });

  it('a space committed early can still earn the word-end slot later', () => {
    const r = replay(cfg, words, opsFrom('a <b ', 10)).score;
    expect(r.correctKeys).toBe(3);
    expect(r.wrongKeys).toBe(1);
    expect(r.repeatKeys).toBe(0);
  });
});

describe('timer', () => {
  const cfg: Config = { ...WORDS_CFG, mode: 'time', durationMs: 1000 };

  it('reports the exact deadline', () => {
    const s = init();
    expect(expiresAt(cfg, s)).toBe(Infinity);
    step(cfg, TEXT, s, { k: 'c', ch: 'c', t: 250 });
    expect(expiresAt(cfg, s)).toBe(1250);
    expect(expiresAt(WORDS_CFG, s)).toBe(Infinity);
  });

  it('an op one millisecond before the cut lands, one at the cut does not', () => {
    const s = init();
    step(cfg, TEXT, s, { k: 'c', ch: 'c', t: 0 });
    step(cfg, TEXT, s, { k: 'c', ch: 'a', t: 999 });
    expect(s.typed[0]).toBe('ca');
    expect(step(cfg, TEXT, s, { k: 'c', ch: 's', t: 1000 })).toEqual({ c: 'none' });
    expect(s.typed[0]).toBe('ca');
    expect(s.phase).toBe('finished');
    expect(s.endT).toBe(1000);
  });

  it('replay closes a time run at the cut when no later op exists', () => {
    const r = replay(cfg, TEXT, [{ k: 'c', ch: 'c', t: 100 }]);
    expect(r.valid).toBe(true);
    expect(r.state.endT).toBe(1100);
    expect(r.score.elapsedMs).toBe(1000);
  });

  it('a time run whose text ran out still scores over the whole duration', () => {
    const r = replay(cfg, ['ab'], opsFrom('ab', 100));
    expect(r.state.endT).toBe(100);
    expect(r.score.elapsedMs).toBe(1000);
    expect(r.score.wpmCx).toBe(2400);
  });
});

describe('replay validation', () => {
  const invalid = (ops: readonly Op[], words = TEXT): string | undefined => replay(WORDS_CFG, words, ops).reason;

  it('rejects bad time', () => {
    expect(invalid([{ k: 'c', ch: 'c', t: 10 }, { k: 'c', ch: 'a', t: 5 }])).toBe('bad-time');
    expect(invalid([{ k: 's', t: 1.5 }])).toBe('bad-time');
    expect(invalid([{ k: 's', t: -1 }])).toBe('bad-time');
    expect(invalid([{ k: 's', t: Number.NaN }])).toBe('bad-time');
    expect(invalid([{ k: 's', t: 2 ** 53 }])).toBe('bad-time');
  });

  it('rejects anything but one printable UTF-16 unit', () => {
    for (const ch of ['', 'ab', '\n', '\t', '\u0000', '\u007f', '\u0085', ' ', '\ud83d', '\ude00', '😀']) {
      expect(invalid([{ k: 'c', ch, t: 0 }]), JSON.stringify(ch)).toBe('bad-char');
    }
  });

  it('rejects hostile shapes without throwing', () => {
    expect(invalid([{ k: 'z', t: 0 } as unknown as Op])).toBe('bad-op');
    expect(invalid([{ k: 'c', t: 0 } as unknown as Op])).toBe('bad-char');
    expect(invalid([], [])).toBe('no-words');
  });

  it('bounds the op count', () => {
    const ops = Array.from({ length: MAX_OPS + 1 }, (): Op => ({ k: 's', t: 0 }));
    expect(invalid(ops)).toBe('too-many-ops');
  });

  it('bounds elapsed time in words mode', () => {
    expect(invalid([{ k: 'c', ch: 'c', t: 0 }, { k: 'c', ch: 'a', t: WORDS_MAX_ELAPSED_MS + 1 }])).toBe('too-long');
  });

  it('fails a run whose speed the integer columns cannot hold, rather than the insert', () => {
    const forged = (text: string): Op[] => opsFrom(text, 0).map((op, i, all) => ({ ...op, t: i === all.length - 1 ? 1 : 0 }));
    const long = 'a'.repeat(MAX_OPS);
    const fast = replay(WORDS_CFG, [long], forged(long));
    expect(fast.valid).toBe(false);
    expect(fast.reason).toBe('out-of-range');
    expect(fast.score.wpmCx).toBe(MAX_CX);
    expect(fast.score.rawCx).toBe(MAX_CX);

    const words = Array.from({ length: 100 }, () => 'ab');
    const extras = forged('z'.repeat(2000) + ' ' + 'z '.repeat(99));
    const raw = replay(WORDS_CFG, words, extras);
    expect(raw.valid).toBe(false);
    expect(raw.reason).toBe('out-of-range');
    expect(raw.score.rawCx).toBeLessThanOrEqual(MAX_CX);
  });

  it('leaves the fastest honest run valid', () => {
    const r = replay(WORDS_CFG, ['abc', 'def'], opsFrom('abc def', 1));
    expect(r.valid).toBe(true);
    expect(r.score.wpmCx).toBeLessThan(MAX_CX);
  });

  it('marks an unfinished words run invalid but still scores what happened', () => {
    const r = replay(WORDS_CFG, TEXT, opsFrom('casa '));
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('unfinished');
    expect(r.score.scoredChars).toBe(4);
    expect(replay(WORDS_CFG, TEXT, []).reason).toBe('unfinished');
  });
});
