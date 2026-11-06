import { challengeDay, msUntilNextDay } from './day';
import { type Config, type LogEntry, MAX_EXTRA } from './core';
import { buildText, generateWords } from './generate';
import { encodeLog } from './log';
import { seedFromHex, xoshiro128pp } from './prng';
import { replay } from './replay';
import { type Score, SCORER_VERSION } from './score';

// Everything here is a frozen fixture: tests/unit/engine/golden.json was generated from it and must never be regenerated
// to make a failure pass. A failure means old results no longer replay. Runs in Node and in every browser engine.

const SEEDS = [
  '6cd115b9544df1866a971ce4a21cae60', '7087adf4190a0953a2ccbc85f8534385', '186b778ab249e71521f6e19e6eb54db0',
  'b20e4d1045a2a0f02974d19846f69ba6', 'ca3fb18315b51d2d0477f8cc86ef5aff', 'dd7fd3a9b4c22ee42244c53bbc0e5408',
  '9428cabb32758ad68462b9a2061ec0ff', '8b96b49d1151633d3c6add9c56a182c6', 'cd42a0b94a7c903b1199378000c41550',
  'fc2855cbcfab3a6c7fa0c76bd265bd2f', 'e218821376ef7c5ad4fa213389ea02db', 'e0ba2b110c1a9856571d554342b13ce8',
  '3813c6f3305647415fbd114fef3ffe40', '3fd0b0746fb0abe5f97dcc5ab70e3e16', '5e7c401587ae1783d3ac63ee5005a10f',
  '777c72eff9f098cc3446cbe9f5466692', 'f975f556f8bfacc2755e188a5f49461a', '48f60026c3a6bbdade9f40cb82510f74',
  'ef0fe9082867dba48372c22ef31a20ca', 'e8c7796e83705cc60706760140471098',
] as const;

const LIST = [
  'a', 'de', 'que', 'não', 'você', 'coração', 'the', 'be', 'word', 'também',
  'ação', 'é', 'já', 'some', 'people', 'time', 'casa', 'mesa', 'tempo', 'água',
] as const;

const WORD_COUNT = 1000;

const TIME_6: Config = { mode: 'time', durationMs: 6000, stopOn: 'none', maxExtra: MAX_EXTRA, backspace: 'incorrect-only' };
const WORDS: Config = { mode: 'words', durationMs: 0, stopOn: 'none', maxExtra: MAX_EXTRA, backspace: 'incorrect-only' };

const TEXT = ['casa', 'não', 'você', 'tempo', 'coração', 'mesa'] as const;

// In a script: space is a space op, < backspace, ^ word delete, ` dead key, and anything else a character.
const SCRIPTS: readonly { name: string; cfg: Config; keys: string; gapScale?: number }[] = [
  { name: 'perfect-words', cfg: WORDS, keys: 'casa não você tempo coração mesa' },
  { name: 'worked-example', cfg: TIME_6, keys: 'casa nao vp<océ<ê tempoo cor me' },
  { name: 'extra-cap', cfg: WORDS, keys: 'casaxxxxxxxxxxxx não você tempo coração mesa' },
  { name: 'return-to-wrong-word', cfg: WORDS, keys: 'cssa <<<<asa não <<<<você tempo coração mesa' },
  { name: 'word-delete', cfg: WORDS, keys: 'casa nxo ^^casa não você^você tempo coração mesa' },
  { name: 'dead-keys', cfg: WORDS, keys: '`casa n`ão voc`ê tempo coraç`ão mesa' },
  { name: 'time-cut', cfg: { ...TIME_6, durationMs: 1000 }, keys: 'casa não você tempo coração mesa', gapScale: 1 },
  { name: 'last-word-wrong-commit', cfg: WORDS, keys: 'casa não você tempo coração me ' },
  { name: 'stop-on-word', cfg: { ...WORDS, stopOn: 'word' }, keys: 'cssa <<<asa não você tempo coração mesa' },
  { name: 'stop-on-letter', cfg: { ...WORDS, stopOn: 'letter' }, keys: 'cxasa nãxo você tempo coração mesa' },
  { name: 'repeated-slots', cfg: WORDS, keys: 'c<c<c^casx <<a não você tempo coração mesa' },
];

export function scriptEntries(keys: string, gapScale = 1): LogEntry[] {
  const entries: LogEntry[] = [];
  let t = 0;
  for (let i = 0; i < keys.length; i++) {
    const ch = keys.charAt(i);
    if (i > 0) t += (60 + ((i * 37) % 83)) * gapScale;
    let entry: LogEntry;
    if (ch === ' ') entry = { k: 's', t };
    else if (ch === '<') entry = { k: 'b', t };
    else if (ch === '^') entry = { k: 'w', t };
    else if (ch === '`') entry = { k: 'd', t };
    else entry = { k: 'c', ch, t };
    if (i % 5 !== 0) entry.h = 40 + ((i * 13) % 60);
    entries.push(entry);
  }
  return entries;
}

/** FNV-1a over UTF-16 units, low byte first, so it needs no encoder. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    h = Math.imul(h ^ (unit & 0xff), 0x01000193);
    h = Math.imul(h ^ (unit >>> 8), 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function hex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

export interface Golden {
  scorerVersion: number;
  words: { seed: string; hash: string; first: string[] }[];
  text: { seed: string; punctuation: string; numbers: string; accentFree: string; all: string }[];
  prng: { seed: string; outputs: number[]; ints: number[] };
  scripts: { name: string; valid: boolean; score: Score; log: string }[];
  days: { epochMs: number; day: string; msLeft: number }[];
}

const DAY_SAMPLES = [
  0, 21_599_999, 21_600_000, 951_782_399_000, 951_804_000_000, 1_709_186_399_999, 1_709_186_400_000,
  1_735_711_199_999, 1_735_711_200_000, 1_798_761_600_000, 4_102_444_800_000, -1,
];

export function computeGolden(): Golden {
  const firstSeed = SEEDS[0];
  const rng = xoshiro128pp(seedFromHex(firstSeed));
  const outputs: number[] = [];
  for (let i = 0; i < 16; i++) outputs.push(rng.next());
  const ints: number[] = [];
  for (let i = 0; i < 16; i++) ints.push(rng.int(1000));
  return {
    scorerVersion: SCORER_VERSION,
    words: SEEDS.map((seed) => {
      const words = generateWords({ seed, list: LIST, count: WORD_COUNT });
      return { seed, hash: fnv1a(words.join(' ')), first: words.slice(0, 5) };
    }),
    text: SEEDS.slice(0, 5).map((seed) => {
      const hash = (flags: { punctuation?: boolean; numbers?: boolean; accentFree?: boolean }): string =>
        fnv1a(buildText({ seed, count: WORD_COUNT, ...flags }, LIST).join(' '));
      return {
        seed,
        punctuation: hash({ punctuation: true }),
        numbers: hash({ numbers: true }),
        accentFree: hash({ accentFree: true }),
        all: hash({ punctuation: true, numbers: true, accentFree: true }),
      };
    }),
    prng: { seed: firstSeed, outputs, ints },
    scripts: SCRIPTS.map(({ name, cfg, keys, gapScale }) => {
      const entries = scriptEntries(keys, gapScale);
      const run = replay(cfg, TEXT, entries);
      return { name, valid: run.valid, score: run.score, log: hex(encodeLog(entries)) };
    }),
    days: DAY_SAMPLES.map((epochMs) => ({ epochMs, day: challengeDay(epochMs), msLeft: msUntilNextDay(epochMs) })),
  };
}

/** The names of every section that differs from the frozen file. Empty means this engine agrees to the bit. */
export function checkGolden(expected: Golden): string[] {
  const actual = computeGolden();
  const mismatches: string[] = [];
  const compare = (path: string, a: unknown, b: unknown): void => {
    if (JSON.stringify(a) !== JSON.stringify(b)) mismatches.push(path);
  };
  compare('scorerVersion', actual.scorerVersion, expected.scorerVersion);
  actual.words.forEach((x, i) => compare(`words[${i}]`, x, expected.words[i]));
  actual.text.forEach((x, i) => compare(`text[${i}]`, x, expected.text[i]));
  compare('prng', actual.prng, expected.prng);
  actual.scripts.forEach((x, i) => compare(`scripts[${x.name}]`, x, expected.scripts[i]));
  actual.days.forEach((x, i) => compare(`days[${i}]`, x, expected.days[i]));
  return mismatches;
}
