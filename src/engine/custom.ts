import { WORDS_MAX_ELAPSED_MS, isTypableUnit } from './core';

// Outside the frozen modules on purpose: custom text is never ranked and is parsed once before a run, so Unicode tables may
// differ between engines here. The run then replays against the words this returned.

// A choice: anyone at 20 WPM finishes the longest text inside replay's words-mode limit.
const MIN_WPM = 20;
export const CUSTOM_MAX_CHARS = (WORDS_MAX_ELAPSED_MS / 60_000) * MIN_WPM * 5;

// Excludes marks NFC could not compose: no key produces one alone, so its word could never be typed right.
const VISIBLE = /^[\p{L}\p{N}\p{P}\p{S}]$/u;

export type CustomText =
  | { ok: true; words: string[] }
  | { ok: false; reason: 'empty' }
  | { ok: false; reason: 'too-long'; chars: number }
  | { ok: false; reason: 'untypable'; char: string };

// The folds the quote packs use. Keyboards produce the plain forms, so a curly target would be a wrong key every time.
function toTypable(raw: string): string {
  return raw
    .replace(/\p{Cf}/gu, '')
    .normalize('NFC')
    .replace(/[‘’ʼ‚‛`´]/g, "'")
    .replace(/[“”„‟«»]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/…/g, '...');
}

/** Refuses before the run the texts replay and encodeLog would reject after it. */
export function parseCustomText(raw: string): CustomText {
  const words = toTypable(raw).split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return { ok: false, reason: 'empty' };
  const chars = words.join(' ').length;
  if (chars > CUSTOM_MAX_CHARS) return { ok: false, reason: 'too-long', chars };
  for (const word of words) {
    for (const char of word) {
      if (!isTypableUnit(char.charCodeAt(0)) || !VISIBLE.test(char)) return { ok: false, reason: 'untypable', char };
    }
  }
  return { ok: true, words };
}
