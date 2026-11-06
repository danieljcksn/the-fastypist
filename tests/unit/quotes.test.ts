import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadEnglishQuotes,
  loadPortugueseQuotes,
  loadQuotes,
  QUOTE_PACK,
  QUOTE_PACK_IDS,
  QUOTE_SHA256,
  quoteWords,
  type QuotePackId,
} from '@/engine/quotes';
import type { Language } from '@/engine/packs';

const DIR = join(process.cwd(), 'src/engine/quotes');
const MIN_PASSAGES = 60;
const MIN_LENGTH = 120;
const MAX_LENGTH = 700;
const LAST_YEAR = 1930;
const LAST_DEATH = 1955;

const TEXT: Readonly<Record<Language, RegExp>> = {
  en: /^[A-Za-z0-9 .,;:!?'"()-]+$/,
  pt: /^[A-Za-z0-9 .,;:!?'"()\-áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]+$/,
};

// Second pass over what was read by hand; a future pack must clear it too.
const BANNED =
  /\b(nigg\w*|negro(es)?|darke?y|darkies|injuns?|coolies?|chinam[ae]n|jews?|gyps(y|ies)|cripples?|whores?|harlots?|mulat\w*|crioul\w*|creoul\w*|cafuz\w*|bugres?|judeus?|judias?|cigan[ao]s?|escrav\w*|mucamas?|moleques?|nhonh\w*|putas?|cad[aá]ver\w*|cannibal\w*|idiots?|gozos?)\b/i;

type Entry = {
  id: string;
  text: string;
  author: string;
  work: string;
  year: number;
  source: string;
  modernized: boolean;
};
type PackFile = {
  id: string;
  language: Language;
  version: number;
  license: string;
  sha256: string;
  quotes: Entry[];
};
type Provenance = {
  rule: string;
  authors: Record<string, { prefix: string; died: number; diedOn: string; checked: string }>;
  works: Record<string, { author: string; year: number; checked: string }>;
  edits: Record<string, [string, string][]>;
};
type Verification = {
  sources: Record<string, { file: string; sha256: string }>;
  packs: Record<string, string>;
  results: Record<string, { ok: boolean; offset?: number; reason?: string }>;
};
type Edit = [string, string];
type Checker = {
  applyEdits(text: string, edits: Edit[]): string;
  checkQuote(quote: { text: string; modernized: boolean }, edits: Edit[], source: string): { ok: boolean; reason?: string };
  isRespelling(edit: Edit): boolean;
  normalizeSource(raw: string): string;
};

// scripts/ is outside the TypeScript project, so this path has to stay computed.
const checker = (await import(/* @vite-ignore */ join(process.cwd(), 'scripts/check-quotes.mjs'))) as Checker;

function read<T>(name: string): T {
  return JSON.parse(readFileSync(join(DIR, name), 'utf8')) as T;
}

const provenance = read<Provenance>('provenance@1.json');
const verification = read<Verification>('verification@1.json');
const packs = QUOTE_PACK_IDS.map((id) => read<PackFile>(`${id}.json`));
const everyQuote = packs.flatMap((pack) => pack.quotes);

describe.each(packs.map((pack) => [pack.id, pack] as const))('%s', (id, pack) => {
  const graphemes = new Intl.Segmenter('und', { granularity: 'grapheme' });

  it('carries the declared header', () => {
    expect(Object.keys(pack)).toEqual(['id', 'language', 'version', 'license', 'sha256', 'quotes']);
    expect(pack.id).toBe(`${pack.language}@${pack.version}`);
    expect(pack.id).toBe(QUOTE_PACK[pack.language]);
    expect(pack.license).toBe('public-domain');
  });

  it('matches its pinned sha256 over the texts', () => {
    const digest = createHash('sha256')
      .update(pack.quotes.map((quote) => quote.text).join('\n'), 'utf8')
      .digest('hex');
    expect(digest).toBe(pack.sha256);
    expect(digest).toBe(QUOTE_SHA256[id as QuotePackId]);
  });

  it('has enough passages in every length band', () => {
    const lengths = pack.quotes.map((quote) => quote.text.length);
    expect(lengths.length).toBeGreaterThanOrEqual(MIN_PASSAGES);
    expect(lengths.filter((n) => n < 220).length).toBeGreaterThanOrEqual(15);
    expect(lengths.filter((n) => n >= 220 && n < 400).length).toBeGreaterThanOrEqual(15);
    expect(lengths.filter((n) => n >= 400).length).toBeGreaterThanOrEqual(15);
  });

  it.each(pack.quotes.map((quote) => [quote.id, quote] as const))('%s obeys the text rules', (_, quote) => {
    const { text } = quote;
    expect(Object.keys(quote)).toEqual(['id', 'text', 'author', 'work', 'year', 'source', 'modernized']);
    expect(text).toMatch(TEXT[pack.language]);
    expect(text.length).toBeGreaterThanOrEqual(MIN_LENGTH);
    expect(text.length).toBeLessThanOrEqual(MAX_LENGTH);
    expect(text).toBe(text.normalize('NFC'));
    expect(text).toBe(text.trim());
    expect(text).not.toContain('  ');
    expect(text).toMatch(/[.!?]["')]?$/);
    expect((text.match(/"/g) ?? []).length % 2).toBe(0);
    expect((text.match(/\(/g) ?? []).length).toBe((text.match(/\)/g) ?? []).length);
    expect(text).not.toMatch(BANNED);
    for (const word of quoteWords(text)) {
      expect(word).not.toBe('');
      expect([...graphemes.segment(word)].length).toBe(word.length);
    }
  });
});

describe('public domain rule', () => {
  it('names ids that are unique and prefixed by author', () => {
    const ids = everyQuote.map((quote) => quote.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const quote of everyQuote) {
      const author = provenance.authors[quote.author];
      expect(author, quote.author).toBeDefined();
      expect(quote.id).toMatch(new RegExp(`^${author?.prefix}-\\d{3}$`));
    }
  });

  it('holds for every author and work', () => {
    for (const quote of everyQuote) {
      const author = provenance.authors[quote.author];
      const work = provenance.works[quote.work];
      expect(author?.died, quote.author).toBeLessThanOrEqual(LAST_DEATH);
      expect(author?.diedOn.slice(0, 4)).toBe(String(author?.died));
      expect(work, quote.work).toBeDefined();
      expect(work?.author).toBe(quote.author);
      expect(quote.year).toBe(work?.year);
      expect(Number.isInteger(quote.year)).toBe(true);
      expect(quote.year).toBeLessThanOrEqual(LAST_YEAR);
    }
  });

  // The source is the 1891-92 edition. "When I heard the learn'd astronomer" first appeared in 1865, so 1855 would be false.
  it('dates Leaves of Grass by the edition the text comes from', () => {
    expect(provenance.works['Leaves of Grass']?.year).toBe(1892);
    const whitman = packs.flatMap((pack) => pack.quotes).filter((quote) => quote.work === 'Leaves of Grass');
    expect(whitman.length).toBeGreaterThan(0);
    for (const quote of whitman) expect(quote.year, quote.id).toBe(1892);
  });

  it('cites a checkable source for every date', () => {
    for (const record of [...Object.values(provenance.authors), ...Object.values(provenance.works)]) {
      expect(record.checked).toMatch(/^https:\/\//);
    }
  });
});

describe('verbatim check', () => {
  it('was recorded for these exact packs and passed everywhere', () => {
    for (const pack of packs) expect(verification.packs[pack.id]).toBe(pack.sha256);
    expect(Object.keys(verification.results).sort()).toEqual(everyQuote.map((quote) => quote.id).sort());
    for (const [id, result] of Object.entries(verification.results)) {
      expect(result.ok, `${id}: ${result.reason ?? ''}`).toBe(true);
    }
  });

  it('logs an edit exactly for the modernized passages', () => {
    for (const quote of everyQuote) {
      const edits = provenance.edits[quote.id] ?? [];
      expect(edits.length > 0, quote.id).toBe(quote.modernized);
      for (const [, to] of edits) expect(quote.text).toContain(to);
    }
    for (const quote of packs.find((pack) => pack.language === 'en')?.quotes ?? []) {
      expect(quote.modernized).toBe(false);
    }
  });

  it('leaves no edit log for a passage the packs no longer carry', () => {
    const ids = new Set(everyQuote.map((quote) => quote.id));
    expect(Object.keys(provenance.edits).filter((id) => !ids.has(id))).toEqual([]);
  });

  it('keeps the old spelling out of the Portuguese text', () => {
    // A homograph survives a word table: plural "tem", "Vem-se" for "Veem-se", "porque" closing a clause for "por quê".
    const old =
      /\b(cousas?|dous|oiro|sahiu|hontem|ella|elle|aquelle|aquella|tambem|philosoph\w*|theatro|egreja|mez|mezes|paiz|os outros a tem|Vêm-se|porque[;.!?])(?![\p{L}-])/iu;
    for (const quote of packs.find((pack) => pack.language === 'pt')?.quotes ?? []) {
      expect(quote.text, quote.id).not.toMatch(old);
    }
  });
});

describe('check-quotes', () => {
  const { applyEdits, checkQuote, isRespelling, normalizeSource } = checker;

  it('refuses an edit that swaps a word instead of respelling it', () => {
    const swaps: Edit[] = [
      ['não', 'sim'],
      ['pai', 'mãe'],
      ['mar', 'sol'],
      ['a', 'o'],
      ['branco', 'preto'],
      ['ama', 'odeia'],
      ['não', ''],
    ];
    for (const swap of swaps) expect(isRespelling(swap), swap.join(' -> ')).toBe(false);
    expect(checkQuote({ text: 'Eu sim vou ao mar.', modernized: true }, [['não', 'sim']], 'Eu não vou ao mar.').ok).toBe(false);
  });

  it('accepts every respelling in the log', () => {
    const logged = Object.values(provenance.edits).flat();
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.filter((edit) => !isRespelling(edit))).toEqual([]);
  });

  it('passes a logged respelling and fails an unlogged change', () => {
    const source = 'Elle ha muitos annos.';
    const edits: Edit[] = [
      ['Elle', 'Ele'],
      ['ha', 'há'],
      ['annos', 'anos'],
    ];
    expect(checkQuote({ text: 'Ele há muitos anos.', modernized: true }, edits, source).ok).toBe(true);
    expect(checkQuote({ text: 'Ele há poucos anos.', modernized: true }, edits, source).ok).toBe(false);
    expect(checkQuote({ text: 'Ele há muitos anos.', modernized: false }, edits, source).ok).toBe(false);
    expect(checkQuote({ text: source, modernized: true }, edits, source).ok).toBe(false);
  });

  it('edits whole tokens only', () => {
    expect(applyEdits('chave ha ha-de', [['ha', 'há']])).toBe('chave há ha-de');
  });

  it('normalizes a source to the typable forms and drops the licence', () => {
    const raw = 'License.\r\n*** START OF THE PROJECT GUTENBERG EBOOK X ***\r\n“Well”—it’s _here_\r\n  now…\r\n*** END OF THE PROJECT GUTENBERG EBOOK X ***\r\nLicense.';
    expect(normalizeSource(raw)).toBe(`"Well"-it's here now...`);
  });
});

describe('loaders', () => {
  it('return the pack per language without the repo-only fields', async () => {
    const [english, portuguese, viaLanguage] = await Promise.all([
      loadEnglishQuotes(),
      loadPortugueseQuotes(),
      loadQuotes('pt'),
    ]);
    expect(english.id).toBe('en@1');
    expect(portuguese.id).toBe('pt@1');
    expect(viaLanguage.sha256).toBe(portuguese.sha256);
    for (const pack of [english, portuguese]) {
      for (const quote of pack.quotes) {
        expect(Object.keys(quote)).toEqual(['id', 'text', 'author', 'work', 'year']);
      }
    }
    expect(JSON.stringify([english, portuguese])).not.toMatch(/gutenberg|wikisource/i);
  });

  it('splits a passage on single spaces, punctuation kept', () => {
    expect(quoteWords('Call me Ishmael. Some years ago-never mind.')).toEqual([
      'Call',
      'me',
      'Ishmael.',
      'Some',
      'years',
      'ago-never',
      'mind.',
    ]);
    const quote = everyQuote[0];
    expect(quote).toBeDefined();
    if (quote) expect(quoteWords(quote.text).join(' ')).toBe(quote.text);
  });
});
