import type { LogEntry } from '@/engine/core';

/** mulberry32: deterministic so a failing shape reproduces, and unrelated to the engine's PRNG. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random: () => number): number {
  const u = 1 - random();
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface Shape {
  interval: (random: () => number, i: number) => number;
  hold: (random: () => number, i: number) => number | undefined;
}

/** Types the words perfectly until durationMs, with the timing shape given. */
export function typed(words: readonly string[], durationMs: number, shape: Shape, seed = 1): LogEntry[] {
  const random = rng(seed);
  const out: LogEntry[] = [];
  let t = 0;
  let n = 0;
  const push = (entry: LogEntry): boolean => {
    const h = shape.hold(random, n);
    out.push(h === undefined ? entry : { ...entry, h });
    n++;
    t += Math.max(0, Math.round(shape.interval(random, n)));
    return t < durationMs;
  };
  for (const word of words) {
    for (const ch of word) if (!push({ k: 'c', ch, t })) return out;
    if (!push({ k: 's', t })) return out;
  }
  return out;
}

const msPerKey = (wpm: number): number => 12_000 / wpm;

/** Log-normal intervals and holds, the shape real typing has. A pause now and then, since people breathe. */
export function humanShape(wpm: number): Shape {
  const mu = Math.log(msPerKey(wpm)) - 0.08;
  return {
    interval: (r, i) => {
      const gap = Math.exp(mu + 0.4 * gaussian(r));
      return i % 97 === 0 ? gap * 6 : gap;
    },
    hold: (r) => Math.round(Math.exp(Math.log(82) + 0.28 * gaussian(r))),
  };
}

export const constantShape = (wpm: number): Shape => ({ interval: () => msPerKey(wpm), hold: () => 60 });

export const instantKeyupShape = (wpm: number): Shape => ({
  interval: humanShape(wpm).interval,
  hold: (r) => Math.floor(r() * 3),
});

export const uniformJitterShape = (wpm: number): Shape => ({
  interval: (r) => msPerKey(wpm) * (0.5 + r()),
  hold: (r) => 50 + r() * 20,
});

export const noKeyupShape = (wpm: number): Shape => ({ interval: humanShape(wpm).interval, hold: () => undefined });
