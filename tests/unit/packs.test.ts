import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPackId, loadPack, PACK_IDS, PACKS, RANKED_PACK, type Language, type PackId, type Tier } from '@/engine/packs';
import { findPack } from '@/engine/packs/server';

const ROOT = process.cwd();
const PACK_DIR = join(ROOT, 'src/engine/packs');
const SIZES: Readonly<Record<Tier, number>> = { '200': 200, '1k': 1000, '5k': 5000 };
const LETTERS: Readonly<Record<Language, RegExp>> = {
  en: /^[a-z]{1,14}$/,
  pt: /^[a-záàâãéêíóôõúüç]{1,14}$/,
};

type PackFile = {
  id: string;
  language: Language;
  version: number;
  license: string;
  sha256: string;
  words: string[];
};

function readPack(id: PackId): PackFile {
  return JSON.parse(readFileSync(join(PACK_DIR, `${id}.json`), 'utf8')) as PackFile;
}

function readExclusions(language: Language): string[] {
  return readFileSync(join(ROOT, `data/review/${language}.exclude.txt`), 'utf8').split('\n').filter(Boolean);
}

function pack(id: PackId): string[] {
  return readPack(id).words;
}

describe.each(PACK_IDS)('%s', (id) => {
  const meta = PACKS[id];
  const file = readPack(id);
  const graphemes = new Intl.Segmenter('und', { granularity: 'grapheme' });

  it('carries the declared header', () => {
    expect(meta.id).toBe(id);
    expect(file.id).toBe(id);
    expect(file.language).toBe(meta.language);
    expect(file.version).toBe(meta.version);
    expect(id).toBe(`${meta.language}-${meta.tier}@${meta.version}`);
    expect(file.license).toBe('CC-BY-SA-4.0');
    expect(Object.keys(file)).toEqual(['id', 'language', 'version', 'license', 'sha256', 'words']);
  });

  it('has the exact size and the declared mean length', () => {
    expect(file.words).toHaveLength(SIZES[meta.tier]);
    expect(meta.size).toBe(file.words.length);
    const mean = file.words.reduce((sum, word) => sum + word.length, 0) / file.words.length;
    expect(Number(mean.toFixed(3))).toBe(meta.meanLength);
  });

  it('hashes the UTF-8 of the space-joined words', () => {
    const actual = createHash('sha256').update(file.words.join(' '), 'utf8').digest('hex');
    expect(file.sha256).toBe(actual);
    expect(meta.sha256).toBe(actual);
  });

  it('holds only unique lowercase NFC letters, one UTF-16 unit per grapheme', () => {
    expect(new Set(file.words).size).toBe(file.words.length);
    for (const word of file.words) {
      expect(word).toMatch(LETTERS[meta.language]);
      expect(word).toBe(word.normalize('NFC'));
      expect(word).toBe(word.toLowerCase());
      expect([...graphemes.segment(word)]).toHaveLength(word.length);
    }
  });

  it('holds nothing the review excluded, unless a newer version replaces it', () => {
    const latest = PACK_IDS.filter((other) => {
      const candidate = PACKS[other];
      return candidate.language === meta.language && candidate.tier === meta.tier;
    }).every((other) => PACKS[other].version <= meta.version);
    if (!latest) return;
    const words = new Set(file.words);
    expect(readExclusions(meta.language).filter((word) => words.has(word))).toEqual([]);
  });

  it('loads the same list dynamically and synchronously', async () => {
    const loaded = await loadPack(id);
    expect(loaded.words).toEqual(file.words);
    expect(findPack(id)?.words).toEqual(file.words);
  });
});

describe('tiers', () => {
  it.each(['en', 'pt'] as const)('%s tiers are prefixes of one frequency-ranked list', (language) => {
    const small = pack(`${language}-200@1`);
    const middle = pack(`${language}-1k@1`);
    const large = pack(`${language}-5k@1`);
    expect(middle.slice(0, 200)).toEqual(small);
    expect(large.slice(0, 1000)).toEqual(middle);
  });

  it('ranks the 1k lists', () => {
    expect(RANKED_PACK).toEqual({ en: 'en-1k@1', pt: 'pt-1k@1' });
  });
});

describe('review', () => {
  it.each(['en', 'pt'] as const)('%s exclude file is one normalized word per line', (language) => {
    const entries = readExclusions(language);
    expect(entries.length).toBeGreaterThan(100);
    expect(new Set(entries).size).toBe(entries.length);
    for (const entry of entries) {
      expect(entry).toBe(entry.trim().toLowerCase().normalize('NFC'));
      expect(entry).not.toMatch(/\s/);
    }
  });

  it('keeps inflected and accented Portuguese', () => {
    const words = new Set(pack('pt-5k@1'));
    for (const word of ['coração', 'não', 'você', 'também', 'pessoas', 'ação', 'já']) {
      expect(words.has(word), word).toBe(true);
    }
  });

  it('keeps innocent Portuguese words that profanity lists flag', () => {
    const words = new Set(pack('pt-5k@1'));
    for (const word of ['frango', 'besta', 'comer', 'cerveja', 'aranha', 'mama']) {
      expect(words.has(word), word).toBe(true);
    }
  });

  it('removes profanity that profanity lists miss, names and subtitle noise', () => {
    const portuguese = new Set(pack('pt-5k@1'));
    for (const word of ['bunda', 'babaca', 'merda', 'porra', 'puta', 'paul', 'tá', 'né', 'pra']) {
      expect(portuguese.has(word), word).toBe(false);
    }
    const english = new Set(pack('en-5k@1'));
    for (const word of ['john', 'jack', 'paul', 'ok', 'hey', 'yeah', 'uh', 'gonna', 'shit', 'fuck', 'die']) {
      expect(english.has(word), word).toBe(false);
    }
  });

  // Real words, but their rank comes from bracketed captions, speaker labels, credits and leftover <font> tags.
  it('removes subtitle captions and credits', () => {
    const english = new Set(pack('en-5k@1'));
    for (const word of ['laughs', 'laughter', 'narrator', 'applause', 'subtitles', 'sync', 'font', 'coughs', 'whirring']) {
      expect(english.has(word), word).toBe(false);
    }
    const portuguese = new Set(pack('pt-5k@1'));
    for (const word of ['legenda', 'legendas', 'tradução', 'revisão', 'sincronia', 'aplausos', 'risos']) {
      expect(portuguese.has(word), word).toBe(false);
    }
  });

  it('removes what the review removed in a sibling form or the other language', () => {
    const english = new Set(pack('en-5k@1'));
    for (const word of ['beep', 'sigh', 'gasp', 'chuckle', 'bleed', 'darn', 'heck']) {
      expect(english.has(word), word).toBe(false);
    }
    const portuguese = new Set(pack('pt-5k@1'));
    for (const word of ['nu', 'nua', 'dane', 'sequestro']) {
      expect(portuguese.has(word), word).toBe(false);
    }
  });

  it.each(['pt-200@1', 'pt-1k@1', 'pt-5k@1'] as const)('%s has a plausible accented share', (id) => {
    const words = pack(id);
    const share = words.filter((word) => /[^a-z]/.test(word)).length / words.length;
    expect(share).toBeGreaterThanOrEqual(0.12);
    expect(share).toBeLessThanOrEqual(0.18);
  });
});

describe('registry', () => {
  it('lists every pack file and no other', () => {
    const files = readdirSync(PACK_DIR).filter((name) => name.endsWith('.json')).sort();
    expect(files).toEqual(PACK_IDS.map((id) => `${id}.json`).sort());
    expect(existsSync(join(PACK_DIR, 'ATTRIBUTION.md'))).toBe(true);
  });

  it('accepts only known ids, whatever the prototype chain holds', () => {
    expect(isPackId('en-1k@1')).toBe(true);
    for (const id of ['en-1k', 'en-1k@2', '__proto__', 'constructor', '']) {
      expect(isPackId(id), id).toBe(false);
      expect(findPack(id), id).toBeUndefined();
    }
  });

  it('keeps lists out of the entry module, so packs stay separate chunks', () => {
    const source = readFileSync(join(PACK_DIR, 'index.ts'), 'utf8');
    expect(source).not.toMatch(/^\s*import\s[^(]*\.json/m);
    expect(source).not.toMatch(/\.\/server/);
    for (const id of PACK_IDS) expect(source).toContain(`import('./${id}.json')`);
  });

  it('does not bind a variable named module, which next lint rejects', () => {
    const source = readFileSync(join(PACK_DIR, 'index.ts'), 'utf8');
    expect(source).not.toMatch(/\b(const|let|var)\s+module\b/);
  });
});

describe('attribution', () => {
  const text = readFileSync(join(PACK_DIR, 'ATTRIBUTION.md'), 'utf8');

  // CC BY-SA 4.0 section 3(a)(1): creator, copyright notice, licence and disclaimer notices, source link, changes.
  it.each([
    ['creator', 'Hermit Dave'],
    ['copyright notice supplied upstream', 'Copyright (c) 2016 Hermit Dave'],
    ['link to the source', 'https://github.com/hermitdave/FrequencyWords'],
    ['pinned version', '525f9b560de45753a5ea01069454e72e9aa541c6'],
    ['link to the licence', 'https://creativecommons.org/licenses/by-sa/4.0/'],
    ['disclaimer of warranties', 'Section 5'],
    ['indication of changes', 'adapted'],
    ['the length limit the build applies', 'longer than 14 letters'],
    ['the link the corpus asks for', 'http://www.opensubtitles.org/'],
    ['the citation the corpus asks for', 'P. Lison and J. Tiedemann'],
  ])('states the %s', (_name, needle) => {
    expect(text).toContain(needle);
  });
});
