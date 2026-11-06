// Permanent: every stored seed replays through this exact sequence, so changing any constant voids all past results.

export type PrngState = [number, number, number, number];

export interface Prng {
  next(): number;
  int(n: number): number;
  state(): PrngState;
}

// SplitMix32-style mix. z chains, so a change in one input word reaches every later output.
function mix(words: readonly [number, number, number, number]): PrngState {
  const out: PrngState = [0, 0, 0, 0];
  let z = 0;
  for (let i = 0; i < 4; i++) {
    z = (z + (words[i] ?? 0) + 0x9e3779b9) | 0;
    let x = z;
    x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
    out[i] = (x ^ (x >>> 16)) >>> 0;
  }
  // xoshiro's all-zero state is a fixed point that would emit zeros forever.
  if ((out[0] | out[1] | out[2] | out[3]) === 0) out[0] = 1;
  return out;
}

function seedWords(hex: string): [number, number, number, number] {
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new RangeError('seed must be 32 hex characters');
  return [
    parseInt(hex.slice(0, 8), 16) >>> 0,
    parseInt(hex.slice(8, 16), 16) >>> 0,
    parseInt(hex.slice(16, 24), 16) >>> 0,
    parseInt(hex.slice(24, 32), 16) >>> 0,
  ];
}

export function seedFromHex(hex: string): PrngState {
  return mix(seedWords(hex));
}

/** An independent stream, so that a text pass toggled on or off never disturbs the word draws. */
export function streamFromHex(hex: string, stream: number): PrngState {
  const [a, b, c, d] = seedWords(hex);
  return mix([(a ^ stream) >>> 0, b, c, d]);
}

// xoshiro128++ 1.0, Blackman and Vigna, https://prng.di.unimi.it/xoshiro128plusplus.c
export function xoshiro128pp(seed: PrngState): Prng {
  let [a, b, c, d] = seed;
  const next = (): number => {
    const sum = (a + d) | 0;
    const result = (((sum << 7) | (sum >>> 25)) + a) >>> 0;
    const t = b << 9;
    c ^= a;
    d ^= b;
    b ^= c;
    a ^= d;
    c ^= t;
    d = (d << 11) | (d >>> 21);
    return result;
  };
  return {
    next,
    int: (n: number) => lemire(next, n),
    state: () => [a >>> 0, b >>> 0, c >>> 0, d >>> 0],
  };
}

const TWO_32 = 0x100000000;
// Keeps next() * n under 2^53, so the product is exact in a double.
const MAX_BOUND = 0x200000;

function lemire(next: () => number, n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > MAX_BOUND) throw new RangeError('bound must be an integer in 1..2^21');
  const threshold = TWO_32 % n;
  for (;;) {
    const m = next() * n;
    if (m % TWO_32 >= threshold) return Math.floor(m / TWO_32);
  }
}
