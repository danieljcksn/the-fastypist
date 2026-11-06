import type { Language } from '../packs';

export const QUOTE_PACK_IDS = ['en@1', 'pt@1'] as const;
export type QuotePackId = (typeof QUOTE_PACK_IDS)[number];

export type Quote = {
  readonly id: string;
  readonly text: string;
  readonly author: string;
  readonly work: string;
  readonly year: number;
};

export type QuotePack = {
  readonly id: QuotePackId;
  readonly language: Language;
  readonly version: number;
  /** Hex SHA-256 of the UTF-8 of every `text` joined by a line feed. */
  readonly sha256: string;
  readonly quotes: readonly Quote[];
};

type QuoteFile = Omit<QuotePack, 'quotes'> & {
  readonly quotes: readonly (Quote & { readonly source: string; readonly modernized: boolean })[];
};

export const QUOTE_PACK: Readonly<Record<Language, QuotePackId>> = { en: 'en@1', pt: 'pt@1' };

// Packs are immutable: replayed runs name a pack, so a fix ships as @2 and @1 stays.
export const QUOTE_SHA256: Readonly<Record<QuotePackId, string>> = {
  'en@1': 'b15f3c6ad6a5394331f7b084fc742b98f9cdf6314980bf03bcf155838511c7f7',
  'pt@1': 'c22a36ca8a43c8e1adc61d65a72411d82424e6a62565c45febecba19c17d8afd',
};

// `source` and `modernized` are repo records. Dropping them here keeps them out of anything the UI can render.
function toPack(file: QuoteFile): QuotePack {
  return {
    id: file.id,
    language: file.language,
    version: file.version,
    sha256: file.sha256,
    quotes: file.quotes.map(({ id, text, author, work, year }) => ({ id, text, author, work, year })),
  };
}

export async function loadEnglishQuotes(): Promise<QuotePack> {
  const { default: file } = await import('./en@1.json');
  return toPack(file as unknown as QuoteFile);
}

export async function loadPortugueseQuotes(): Promise<QuotePack> {
  const { default: file } = await import('./pt@1.json');
  return toPack(file as unknown as QuoteFile);
}

export function loadQuotes(language: Language): Promise<QuotePack> {
  return language === 'en' ? loadEnglishQuotes() : loadPortugueseQuotes();
}

export function quoteWords(text: string): string[] {
  return text.split(' ');
}
