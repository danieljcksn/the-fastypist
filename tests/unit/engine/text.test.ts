import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildText, foldAccents, generateWords, wordCountForDuration } from '@/engine/generate';
import { layoutLines } from '@/engine/layout';
import { seedFromHex, streamFromHex, xoshiro128pp } from '@/engine/prng';
import { LIST, RUNS, arbSeed } from './arbitraries';

const SEED = '6cd115b9544df1866a971ce4a21cae60';

// From the public-domain xoshiro128plusplus.c, compiled with gcc.
const REFERENCE_OUTPUTS = [641, 1573767, 3222811527, 3517856514, 836907274, 4247214768, 3867114732, 1355841295];

describe('prng', () => {
  it('matches the reference C implementation from state 1,2,3,4', () => {
    const rng = xoshiro128pp([1, 2, 3, 4]);
    const out = Array.from({ length: 8 }, () => rng.next());
    expect(out).toEqual(REFERENCE_OUTPUTS);
  });

  it('rejects malformed seeds instead of silently seeding from NaN', () => {
    for (const bad of ['', 'abc', 'g'.repeat(32), SEED + '0']) expect(() => seedFromHex(bad)).toThrow(RangeError);
  });

  it('never leaves the all-zero state', () => {
    expect(seedFromHex('0'.repeat(32)).some((x) => x !== 0)).toBe(true);
  });

  it('derives streams that differ from each other and from the base in every word', () => {
    const base = seedFromHex(SEED);
    const one = streamFromHex(SEED, 1);
    const two = streamFromHex(SEED, 2);
    for (let i = 0; i < 4; i++) {
      expect(one[i]).not.toBe(base[i]);
      expect(two[i]).not.toBe(one[i]);
    }
  });

  it('keeps int(n) in range', () => {
    fc.assert(
      fc.property(arbSeed, fc.integer({ min: 1, max: 2 ** 21 }), (seed, n) => {
        const rng = xoshiro128pp(seedFromHex(seed));
        for (let i = 0; i < 20; i++) {
          const x = rng.int(n);
          if (!Number.isInteger(x) || x < 0 || x >= n) return false;
        }
        return true;
      }),
      RUNS,
    );
  });

  it('rejects bounds that would lose precision', () => {
    const rng = xoshiro128pp(seedFromHex(SEED));
    for (const n of [0, -1, 1.5, 2 ** 21 + 1]) expect(() => rng.int(n)).toThrow(RangeError);
  });
});

describe('generateWords', () => {
  it('holds the window even on a list barely larger than it', () => {
    fc.assert(
      fc.property(arbSeed, (seed) => {
        const a = generateWords({ seed, list: ['a', 'b', 'c', 'd'], count: 200 });
        for (let i = 1; i < a.length; i++) {
          for (let j = Math.max(0, i - 3); j < i; j++) if (a[i] === a[j]) return false;
        }
        return true;
      }),
      RUNS,
    );
  });

  it('copes with lists too small for the window', () => {
    expect(generateWords({ seed: SEED, list: ['a'], count: 3 })).toEqual(['a', 'a', 'a']);
    const two = generateWords({ seed: SEED, list: ['a', 'b'], count: 20 });
    for (let i = 1; i < two.length; i++) expect(two[i]).not.toBe(two[i - 1]);
  });

  it('rejects an empty list and a bad count', () => {
    expect(() => generateWords({ seed: SEED, list: [], count: 1 })).toThrow(RangeError);
    expect(() => generateWords({ seed: SEED, list: LIST, count: -1 })).toThrow(RangeError);
    expect(generateWords({ seed: SEED, list: [], count: 0 })).toEqual([]);
  });

  it('pre-generates ten words a second', () => {
    expect(wordCountForDuration(60_000)).toBe(600);
  });
});

describe('buildText passes', () => {
  const strip = (word: string): string => word.replace(/[.,;:?!]+$/, '').toLowerCase();

  it('plain text is exactly generateWords', () => {
    expect(buildText({ seed: SEED, count: 50 }, LIST)).toEqual(generateWords({ seed: SEED, list: LIST, count: 50 }));
  });

  it('punctuation only decorates the same words, and every word stays typable', () => {
    fc.assert(
      fc.property(arbSeed, fc.integer({ min: 1, max: 200 }), (seed, count) => {
        const plain = buildText({ seed, count }, LIST);
        const marked = buildText({ seed, count, punctuation: true }, LIST);
        expect(marked.map(strip)).toEqual(plain);
        expect(marked[0]?.charAt(0)).toBe(capitalFirst(plain[0] ?? ''));
        expect(marked[count - 1]).toMatch(/[.?!]$/);
      }),
      RUNS,
    );
  });

  it('numbers replace some words and leave the rest in place', () => {
    fc.assert(
      fc.property(arbSeed, (seed) => {
        const plain = buildText({ seed, count: 200 }, LIST);
        const mixed = buildText({ seed, count: 200, numbers: true }, LIST);
        mixed.forEach((word, i) => {
          if (word !== plain[i]) expect(word).toMatch(/^[1-9][0-9]{0,3}$/);
        });
        return mixed.some((word) => /^\d/.test(word));
      }),
      { numRuns: 200 },
    );
  });

  it('is deterministic with every pass on, and a pass never disturbs another', () => {
    const spec = { seed: SEED, count: 300, punctuation: true, numbers: true, accentFree: true };
    expect(buildText(spec, LIST)).toEqual(buildText(spec, LIST));
    const numbers = buildText({ seed: SEED, count: 300, numbers: true }, LIST);
    const both = buildText({ seed: SEED, count: 300, numbers: true, punctuation: true }, LIST);
    expect(both.map(strip)).toEqual(numbers);
  });

  it('accent-free folds through the table and keeps one unit per letter', () => {
    expect(foldAccents('coração')).toBe('coracao');
    expect(foldAccents('não você à pôr céu ação água ÁÉÍÓÚ Ç Ã Õ Ê Ô')).toBe('nao voce a por ceu acao agua AEIOU C A O E O');
    const pt = 'áàâãäéèêëíìîïóòôõöúùûüçñ';
    expect(foldAccents(pt)).toBe('aaaaaeeeeiiiiooooouuuucn');
    expect(foldAccents(pt)).toMatch(/^[a-z]+$/);
    expect(foldAccents('plain')).toBe('plain');
  });

  it('the window sees folded spellings, so é and e never sit together', () => {
    fc.assert(
      fc.property(arbSeed, (seed) => {
        const a = buildText({ seed, count: 100, accentFree: true }, ['é', 'e', 'a', 'b', 'c', 'd']);
        for (let i = 1; i < a.length; i++) if (a[i] === a[i - 1]) return false;
        return a.every((w) => /^[a-e]$/.test(w));
      }),
      { numRuns: 200 },
    );
  });

  it('capitalizing keeps a word one unit per letter', () => {
    const marked = buildText({ seed: SEED, count: 100, punctuation: true }, ['ação', 'água', 'é', 'ßa', '1a']);
    const plain = buildText({ seed: SEED, count: 100 }, ['ação', 'água', 'é', 'ßa', '1a']);
    marked.forEach((word, i) => expect(word.replace(/[.,;:?!]$/, '').length).toBe(plain[i]?.length));
    expect(marked.some((w) => w.startsWith('Á') || w.startsWith('É'))).toBe(true);
  });
});

function capitalFirst(word: string): string {
  return word.charAt(0).toUpperCase();
}

describe('layoutLines', () => {
  it('keeps a word wider than the line on its own line', () => {
    expect(layoutLines(['abcdefghij', 'a'], 5)).toEqual([
      { first: 0, last: 0, cols: 10 },
      { first: 1, last: 1, cols: 1 },
    ]);
  });

  it('honours from and maxLines', () => {
    const words = ['aa', 'bb', 'cc', 'dd', 'ee', 'ff'];
    expect(layoutLines(words, 5, 2, 1)).toEqual([{ first: 2, last: 3, cols: 5 }]);
    expect(layoutLines([], 10)).toEqual([]);
  });
});
