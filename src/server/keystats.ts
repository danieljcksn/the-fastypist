import { type Config, type LogEntry, init, step } from '@/engine/core';
import type { Language } from '@/engine/packs';

// Stored bytes index into these, so they only ever grow at the end. A test holds every pack's letters inside them.
const ALPHABET: Readonly<Record<Language, string>> = {
  en: ' abcdefghijklmnopqrstuvwxyz',
  pt: ' abcdefghijklmnopqrstuvwxyzáàâãéêíóôõúüç',
};

// Two u16 per key. u8 misses, as first drafted, saturate within a week: 255 misses is about ten runs at 90%.
const BYTES_PER_KEY = 4;
const MAX_COUNT = 0xffff;

export interface KeyCount {
  key: string;
  hits: number;
  misses: number;
}

/** Counts per target letter, never timings. Walks the engine so an erased or extra letter counts as what the typist saw. */
export function countKeys(config: Config, words: readonly string[], entries: readonly LogEntry[], language: Language): Buffer {
  const alphabet = ALPHABET[language];
  const hits = new Array<number>(alphabet.length).fill(0);
  const misses = new Array<number>(alphabet.length).fill(0);
  const add = (key: string, ok: boolean): void => {
    const at = alphabet.indexOf(key);
    if (at < 0) return;
    const into = ok ? hits : misses;
    into[at] = (into[at] ?? 0) + 1;
  };
  const state = init();
  for (const entry of entries) {
    const change = step(config, words, state, entry);
    if (change.c === 'letter' && !change.extra) add((words[change.w] ?? '').charAt(change.i), change.ok);
    else if (change.c === 'commit') add(' ', change.missed === 0);
  }
  const out = Buffer.alloc(alphabet.length * BYTES_PER_KEY);
  for (let i = 0; i < alphabet.length; i++) {
    out.writeUInt16BE(Math.min(MAX_COUNT, hits[i] ?? 0), i * BYTES_PER_KEY);
    out.writeUInt16BE(Math.min(MAX_COUNT, misses[i] ?? 0), i * BYTES_PER_KEY + 2);
  }
  return out;
}

/** Saturating, and tolerant of an older row from before the alphabet grew. */
export function mergeCounts(a: Buffer, b: Buffer): Buffer {
  const longer = a.length >= b.length ? a : b;
  const out = Buffer.from(longer);
  const shorter = longer === a ? b : a;
  for (let at = 0; at + 2 <= shorter.length; at += 2) {
    out.writeUInt16BE(Math.min(MAX_COUNT, out.readUInt16BE(at) + shorter.readUInt16BE(at)), at);
  }
  return out;
}

export function decodeCounts(counts: Buffer, language: Language): KeyCount[] {
  const alphabet = ALPHABET[language];
  const out: KeyCount[] = [];
  for (let i = 0; i < alphabet.length && (i + 1) * BYTES_PER_KEY <= counts.length; i++) {
    const hits = counts.readUInt16BE(i * BYTES_PER_KEY);
    const missCount = counts.readUInt16BE(i * BYTES_PER_KEY + 2);
    if (hits > 0 || missCount > 0) out.push({ key: alphabet.charAt(i), hits, misses: missCount });
  }
  return out;
}

export const keyAlphabet = (language: Language): string => ALPHABET[language];

/** The Monday of a YYYY-MM-DD, as a YYYY-MM-DD. */
export function weekStartOf(localDay: string): string {
  const date = new Date(`${localDay}T00:00:00Z`);
  const sinceMonday = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - sinceMonday * 86_400_000).toISOString().slice(0, 10);
}
