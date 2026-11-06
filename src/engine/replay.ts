import { type Config, type Op, type State, MAX_OPS, WORDS_MAX_ELAPSED_MS, expire, init, isTypableUnit, step } from './core';
import { MAX_CX, type Score, score } from './score';

export type ReplayReason = 'no-words' | 'too-many-ops' | 'bad-op' | 'bad-time' | 'bad-char' | 'too-long' | 'unfinished' | 'out-of-range';

export interface Replay {
  state: State;
  score: Score;
  valid: boolean;
  reason?: ReplayReason;
}

function validOp(op: Op): boolean {
  return op.k === 'c' || op.k === 's' || op.k === 'b' || op.k === 'w' || op.k === 'd';
}

export function replay(cfg: Config, words: readonly string[], ops: readonly Op[]): Replay {
  const s = init();
  const fail = (reason: ReplayReason): Replay => ({ state: s, score: score(cfg, words, s), valid: false, reason });
  if (words.length === 0) return fail('no-words');
  if (ops.length > MAX_OPS) return fail('too-many-ops');
  let prev = 0;
  for (const op of ops) {
    if (!validOp(op)) return fail('bad-op');
    if (!Number.isSafeInteger(op.t) || op.t < prev) return fail('bad-time');
    prev = op.t;
    if (op.k === 'c' && (typeof op.ch !== 'string' || op.ch.length !== 1 || !isTypableUnit(op.ch.charCodeAt(0)))) {
      return fail('bad-char');
    }
    if (cfg.mode === 'words' && s.phase === 'running' && op.t - s.startT > WORDS_MAX_ELAPSED_MS) return fail('too-long');
    step(cfg, words, s, op);
  }
  expire(cfg, s);
  if (s.phase !== 'finished') return fail('unfinished');
  const result = score(cfg, words, s);
  // Net never exceeds raw, so this covers both columns. A limit of the schema, not a plausibility threshold.
  if (result.rawCx === MAX_CX) return fail('out-of-range');
  return { state: s, score: result, valid: true };
}
