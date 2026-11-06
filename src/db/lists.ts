import type { PackId } from '@/engine/packs';

// Mirrors the word_lists seed migration. Ids are permanent: rows in results reference them.
export const LIST_IDS: Readonly<Record<PackId, number>> = {
  'en-200@1': 1,
  'en-1k@1': 2,
  'en-5k@1': 3,
  'pt-200@1': 4,
  'pt-1k@1': 5,
  'pt-5k@1': 6,
};
