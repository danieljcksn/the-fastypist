import { describe, expect, it } from 'vitest';
import { type Golden, checkGolden, computeGolden, fnv1a } from '@/engine/golden-check';
import { SCORER_VERSION } from '@/engine/score';
import frozen from './golden.json';

describe('golden vectors', () => {
  it('this engine agrees with the frozen file', () => {
    expect(checkGolden(frozen as Golden)).toEqual([]);
  });

  it('covers 20 seeds and the op scripts', () => {
    expect(frozen.words).toHaveLength(20);
    expect(new Set(frozen.words.map((x) => x.hash)).size).toBe(20);
    expect(frozen.scripts.length).toBeGreaterThanOrEqual(10);
  });

  it('pins the scorer version, and reports a change to it', () => {
    expect(frozen.scorerVersion).toBe(SCORER_VERSION);
    expect(checkGolden({ ...(frozen as Golden), scorerVersion: SCORER_VERSION + 1 })).toEqual(['scorerVersion']);
  });

  it('freezes the rule that a slot earns one correct key', () => {
    const script = frozen.scripts.find((x) => x.name === 'repeated-slots');
    expect(script?.score.repeatKeys).toBeGreaterThan(0);
  });

  it('checkGolden reports a tampered section', () => {
    const tampered = computeGolden();
    const first = tampered.scripts[0];
    if (first === undefined) throw new Error('no scripts');
    first.score.wpmCx += 1;
    expect(checkGolden(tampered)).toEqual(['scripts[perfect-words]']);
  });

  it('fnv1a matches its published offset basis and test vector', () => {
    expect(fnv1a('')).toBe('811c9dc5');
    // Two bytes per unit, so 'a' hashes as the bytes 61 00.
    expect(fnv1a('a')).toBe(FNV_OF_61_00);
  });
});

const FNV_OF_61_00 = '2b24d044';
