import fc from 'fast-check';
import { type Config, type LogEntry, type Op, type State, init, step } from '@/engine/core';

export const RUNS = { numRuns: 1000 };

export const LIST = ['a', 'de', 'que', 'não', 'você', 'coração', 'the', 'be', 'word', 'também', 'ação', 'é', 'já', 'some', 'people'];

export const WORDS_CFG: Config = { mode: 'words', durationMs: 0, stopOn: 'none', maxExtra: 8, backspace: 'incorrect-only' };

export const arbCfg: fc.Arbitrary<Config> = fc.record({
  mode: fc.constantFrom<Config['mode']>('time', 'words'),
  durationMs: fc.constantFrom(15000, 30000, 60000),
  stopOn: fc.constantFrom<Config['stopOn']>('none', 'word', 'letter'),
  maxExtra: fc.constantFrom(0, 1, 8),
  backspace: fc.constantFrom<Config['backspace']>('incorrect-only', 'never'),
});

// size: 'max' is load-bearing. The default sizing caps arrays near 10 items, and such a run never leaves its first words.
export const arbWords = fc.array(fc.constantFrom(...LIST), { minLength: 1, maxLength: 30, size: 'max' });

export const arbSeed = fc.string({ unit: fc.constantFrom(...'0123456789abcdef'), minLength: 32, maxLength: 32 });

export interface Key {
  r: number;
  ch: string;
  dt: number;
}

export const arbScript: fc.Arbitrary<Key[]> = fc.array(
  fc.record({ r: fc.nat(99), ch: fc.constantFrom(...'abcdeãçéxyz'), dt: fc.nat(400) }),
  { maxLength: 300, size: 'max' },
);

/** Biased so the typist is usually right: a uniform stream never reaches the interesting states. */
export function toOps(words: readonly string[], cfg: Config, script: readonly Key[]): Op[] {
  const s = init();
  const ops: Op[] = [];
  let t = 1000;
  for (const a of script) {
    t += a.dt;
    const target = words[s.w] ?? '';
    const cur = s.typed[s.w] ?? '';
    let op: Op;
    if (a.r < 66) {
      const next = target.charAt(cur.length);
      op = cur.length < target.length ? { k: 'c', ch: next, t } : { k: 's', t };
    } else if (a.r < 76) op = { k: 'c', ch: a.ch, t };
    else if (a.r < 84) op = { k: 's', t };
    else if (a.r < 92) op = { k: 'b', t };
    else if (a.r < 96) op = { k: 'w', t };
    else op = { k: 'd', t };
    ops.push(op);
    step(cfg, words, s, op);
  }
  return ops;
}

export const arbRun: fc.Arbitrary<[Config, string[], Op[]]> = fc
  .tuple(arbCfg, arbWords, arbScript)
  .map(([cfg, words, script]) => [cfg, words, toOps(words, cfg, script)]);

export const withHolds = (ops: readonly Op[], holds: readonly (number | undefined)[]): LogEntry[] =>
  ops.map((op, i) => {
    const h = holds[i % Math.max(1, holds.length)];
    return h === undefined ? { ...op } : { ...op, h };
  });

export function run(cfg: Config, words: readonly string[], ops: readonly Op[]): State {
  const s = init();
  for (const op of ops) step(cfg, words, s, op);
  return s;
}

export function opsFrom(keys: string, gap = 100, start = 0): LogEntry[] {
  const ops: LogEntry[] = [];
  let t = start;
  for (const ch of keys) {
    if (ch === ' ') ops.push({ k: 's', t });
    else if (ch === '<') ops.push({ k: 'b', t });
    else if (ch === '^') ops.push({ k: 'w', t });
    else if (ch === '`') ops.push({ k: 'd', t });
    else ops.push({ k: 'c', ch, t });
    t += gap;
  }
  return ops;
}
