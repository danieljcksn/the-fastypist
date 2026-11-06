import { type Prng, seedFromHex, streamFromHex, xoshiro128pp } from './prng';

// Stream ids and every table and rate below are part of the text contract: changing one changes old texts.
const STREAM_NUMBERS = 1;
const STREAM_PUNCTUATION = 2;

const NUMBER_PERCENT = 12;
const COMMA_PERCENT = 12;
const SENTENCE_MIN_WORDS = 4;
const SENTENCE_SPREAD = 9;
const SENTENCE_ENDS = ['.', '.', '.', '.', '.', '.', '.', '?', '?', '!'] as const;
const MID_MARKS = [',', ',', ',', ',', ',', ',', ',', ',', ';', ':'] as const;

const REDRAWS = 16;

const ACCENT_FREE: Readonly<Record<string, string>> = {
  á: 'a', à: 'a', â: 'a', ã: 'a', ä: 'a',
  é: 'e', è: 'e', ê: 'e', ë: 'e',
  í: 'i', ì: 'i', î: 'i', ï: 'i',
  ó: 'o', ò: 'o', ô: 'o', õ: 'o', ö: 'o',
  ú: 'u', ù: 'u', û: 'u', ü: 'u',
  ç: 'c', ñ: 'n',
  Á: 'A', À: 'A', Â: 'A', Ã: 'A', Ä: 'A',
  É: 'E', È: 'E', Ê: 'E', Ë: 'E',
  Í: 'I', Ì: 'I', Î: 'I', Ï: 'I',
  Ó: 'O', Ò: 'O', Ô: 'O', Õ: 'O', Ö: 'O',
  Ú: 'U', Ù: 'U', Û: 'U', Ü: 'U',
  Ç: 'C', Ñ: 'N',
};

export interface TextSpec {
  /** 32 hex characters. */
  seed: string;
  /** NFC with one UTF-16 unit per grapheme, enforced when the pack is built. */
  list: readonly string[];
  count: number;
  noRepeatWindow?: number;
}

export interface TestSpec {
  seed: string;
  count: number;
  punctuation?: boolean;
  numbers?: boolean;
  accentFree?: boolean;
}

function usedWithin(out: readonly string[], end: number, window: number, word: string | undefined): boolean {
  for (let j = end - 1; j >= 0 && j >= end - window; j--) if (out[j] === word) return true;
  return false;
}

export function generateWords(spec: TextSpec): string[] {
  const { list, count } = spec;
  if (!Number.isInteger(count) || count < 0) throw new RangeError('count must be a non-negative integer');
  if (count === 0) return [];
  const n = list.length;
  if (n === 0) throw new RangeError('word list is empty');
  const rng = xoshiro128pp(seedFromHex(spec.seed));
  const window = Math.min(spec.noRepeatWindow ?? 3, n - 1);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    let idx = rng.int(n);
    for (let tries = 0; tries < REDRAWS && usedWithin(out, i, window, list[idx]); tries++) idx = rng.int(n);
    // Bounded redraws keep the draw count finite. The scan draws nothing, so the stream stays aligned.
    for (let scan = 0; scan < n && usedWithin(out, i, window, list[idx]); scan++) idx = (idx + 1) % n;
    out.push(list[idx] ?? '');
  }
  return out;
}

/** A table, never String.normalize: that depends on the engine's Unicode tables, and this output is frozen. */
export function foldAccents(word: string): string {
  let out = '';
  for (let i = 0; i < word.length; i++) {
    const ch = word.charAt(i);
    out += ACCENT_FREE[ch] ?? ch;
  }
  return out;
}

// Not toUpperCase: it turns ß into SS, and the engine requires one unit to stay one unit.
function capitalize(word: string): string {
  const code = word.charCodeAt(0);
  const lowerAscii = code >= 0x61 && code <= 0x7a;
  const lowerLatin1 = code >= 0xe0 && code <= 0xfe && code !== 0xf7;
  return lowerAscii || lowerLatin1 ? String.fromCharCode(code - 32) + word.slice(1) : word;
}

function pick(rng: Prng, table: readonly string[]): string {
  return table[rng.int(table.length)] ?? '';
}

function addNumbers(words: string[], seed: string): void {
  const rng = xoshiro128pp(streamFromHex(seed, STREAM_NUMBERS));
  for (let i = 0; i < words.length; i++) {
    if (rng.int(100) >= NUMBER_PERCENT) continue;
    const extraDigits = rng.int(4);
    let digits = String(1 + rng.int(9));
    for (let d = 0; d < extraDigits; d++) digits += String(rng.int(10));
    words[i] = digits;
  }
}

function addPunctuation(words: string[], seed: string): void {
  const rng = xoshiro128pp(streamFromHex(seed, STREAM_PUNCTUATION));
  let left = 0;
  for (let i = 0; i < words.length; i++) {
    let word = words[i] ?? '';
    if (left === 0) {
      left = SENTENCE_MIN_WORDS + rng.int(SENTENCE_SPREAD);
      word = capitalize(word);
    }
    left--;
    if (left === 0 || i === words.length - 1) word += pick(rng, SENTENCE_ENDS);
    else if (rng.int(100) < COMMA_PERCENT) word += pick(rng, MID_MARKS);
    words[i] = word;
  }
}

/**
 * The passes run after the draw on their own streams, so toggling one leaves the words in place.
 * Folding runs first: two accented words can fold to one spelling, and the no-repeat window must see that.
 */
export function buildText(spec: TestSpec, list: readonly string[]): string[] {
  const source = spec.accentFree ? list.map(foldAccents) : list;
  const words = generateWords({ seed: spec.seed, list: source, count: spec.count });
  if (spec.numbers) addNumbers(words, spec.seed);
  if (spec.punctuation) addPunctuation(words, spec.seed);
  return words;
}

/** Ten words a second is 600 WPM, more text than anyone reaches. */
export function wordCountForDuration(durationMs: number): number {
  return Math.ceil(durationMs / 100);
}
