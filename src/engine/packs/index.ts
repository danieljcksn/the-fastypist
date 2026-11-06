export type Language = 'en' | 'pt';
export type Tier = '200' | '1k' | '5k';

export const PACK_IDS = ['en-200@1', 'en-1k@1', 'en-5k@1', 'pt-200@1', 'pt-1k@1', 'pt-5k@1'] as const;
export type PackId = (typeof PACK_IDS)[number];

export type Pack = {
  readonly id: PackId;
  readonly language: Language;
  readonly version: number;
  readonly license: 'CC-BY-SA-4.0';
  /** Hex SHA-256 of the UTF-8 of `words.join(' ')`. */
  readonly sha256: string;
  readonly words: readonly string[];
};

export type PackMeta = {
  readonly id: PackId;
  readonly language: Language;
  readonly tier: Tier;
  readonly version: number;
  readonly size: number;
  readonly meanLength: number;
  readonly sha256: string;
};

export const PACKS: Readonly<Record<PackId, PackMeta>> = {
  'en-200@1': {
    id: 'en-200@1',
    language: 'en',
    tier: '200',
    version: 1,
    size: 200,
    meanLength: 3.98,
    sha256: 'a59f96d6548c04d5ec245256f752fe7760524097d2357e83dee69a310efafc26',
  },
  'en-1k@1': {
    id: 'en-1k@1',
    language: 'en',
    tier: '1k',
    version: 1,
    size: 1000,
    meanLength: 5.115,
    sha256: '68285177e967986972b5b7765efc621f7e9b9dd706361a47f31a19790edc5bd4',
  },
  'en-5k@1': {
    id: 'en-5k@1',
    language: 'en',
    tier: '5k',
    version: 1,
    size: 5000,
    meanLength: 6.23,
    sha256: 'b0406b2fc6f6dfda21beb03a0de061fb1bca8b4e55981a8bd9739f41334bf7d0',
  },
  'pt-200@1': {
    id: 'pt-200@1',
    language: 'pt',
    tier: '200',
    version: 1,
    size: 200,
    meanLength: 4.145,
    sha256: 'c4760af11cdf3e0af9c19a9f6a1620208b78356dfa2a49230092cd47db89acc6',
  },
  'pt-1k@1': {
    id: 'pt-1k@1',
    language: 'pt',
    tier: '1k',
    version: 1,
    size: 1000,
    meanLength: 5.476,
    sha256: 'b92d53ad5f16bd5914ad031c28102896824c48260c6d7cb44c3aab26f7fd9879',
  },
  'pt-5k@1': {
    id: 'pt-5k@1',
    language: 'pt',
    tier: '5k',
    version: 1,
    size: 5000,
    meanLength: 6.693,
    sha256: 'c2b339c3a2758d193770dab8ba77c6af9e0db84a5128ba17ea250dad0580c3d7',
  },
};

export const RANKED_PACK: Readonly<Record<Language, PackId>> = { en: 'en-1k@1', pt: 'pt-1k@1' };

export function isPackId(value: string): value is PackId {
  return (PACK_IDS as readonly string[]).includes(value);
}

// One literal import per pack: a bundler splits chunks only on paths it can read statically.
const LOADERS: Readonly<Record<PackId, () => Promise<{ default: unknown }>>> = {
  'en-200@1': () => import('./en-200@1.json'),
  'en-1k@1': () => import('./en-1k@1.json'),
  'en-5k@1': () => import('./en-5k@1.json'),
  'pt-200@1': () => import('./pt-200@1.json'),
  'pt-1k@1': () => import('./pt-1k@1.json'),
  'pt-5k@1': () => import('./pt-5k@1.json'),
};

export async function loadPack(id: PackId): Promise<Pack> {
  const loaded = await LOADERS[id]();
  return loaded.default as Pack;
}
