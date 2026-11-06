import { type Config, type State, insertions } from './core';

// Only + - * / and Math.round from here down: IEEE-754 and the spec pin those, so every engine agrees to the bit.

/** Goes on every ticket and result. Any change that moves a score bumps it, and the old scorer stays for the logs it scored. */
export const SCORER_VERSION = 1;

// The `integer` columns' ceiling. No human is near it, but a forged log is: 65536 keys in 1 ms is 78,643,200,000.
export const MAX_CX = 2_147_483_647;

export interface Score {
  elapsedMs: number;
  wpm: number;
  rawWpm: number;
  accuracy: number;
  wpmCx: number;
  rawCx: number;
  accuracyBp: number;
  finalTextAccuracy: number;
  finalTextBp: number;
  correctKeys: number;
  wrongKeys: number;
  repeatKeys: number;
  deadKeys: number;
  backspaces: number;
  ignored: number;
  wordsCorrect: number;
  wordsWrong: number;
  chars: { correct: number; incorrect: number; extra: number; missed: number };
  scoredChars: number;
}

/** 12·Cw/T in centi-WPM, T in ms. */
export function wpmCx(creditedChars: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  const cx = Math.round((1_200_000 * creditedChars) / elapsedMs);
  return cx < MAX_CX ? cx : MAX_CX;
}

export function rawCx(keys: number, elapsedMs: number): number {
  return wpmCx(keys, elapsedMs);
}

export function accuracyBp(correct: number, wrong: number): number {
  const total = correct + wrong;
  if (total === 0) return 0;
  const bp = Math.round((10_000 * correct) / total);
  // One error in 20,000 keys would otherwise round to a claim of perfection.
  return bp === 10_000 && wrong > 0 ? 9_999 : bp;
}

/**
 * Cw: each word exactly right at commit plus its space, plus the correct prefix of the unfinished word.
 * Words mode credits Cw−1, per MacKenzie: its T runs first key to last, so n characters span n−1 intervals. That is separate
 * from the last word earning no space. Time mode's T comes from the mode, so it keeps all of Cw.
 */
export function creditedChars(cfg: Config, words: readonly string[], s: State): number {
  const last = words.length - 1;
  let n = 0;
  for (let i = 0; i <= s.w; i++) {
    const t = words[i];
    const y = s.typed[i];
    if (t === undefined || y === undefined) continue;
    if (i < s.w || s.allCommitted) {
      if (y === t) n += i < last ? t.length + 1 : t.length;
    } else if (t.startsWith(y)) {
      n += y.length;
    }
  }
  return cfg.mode === 'words' && n > 0 ? n - 1 : n;
}

function wordsElapsed(s: State): number {
  if (s.phase === 'finished') return s.endT - s.startT;
  return s.phase === 'running' ? s.lastT - s.startT : 0;
}

export function score(cfg: Config, words: readonly string[], s: State): Score {
  const elapsedMs = cfg.mode === 'time' ? cfg.durationMs : wordsElapsed(s);
  const last = words.length - 1;
  let wordsCorrect = 0;
  let wordsWrong = 0;
  let correct = 0;
  let incorrect = 0;
  let extra = 0;
  let missed = 0;
  let spacesRight = 0;
  let spacesWrong = 0;
  for (let i = 0; i <= s.w; i++) {
    const t = words[i];
    const y = s.typed[i];
    if (t === undefined || y === undefined) continue;
    const n = t.length < y.length ? t.length : y.length;
    for (let j = 0; j < n; j++) {
      if (t.charCodeAt(j) === y.charCodeAt(j)) correct++;
      else incorrect++;
    }
    if (y.length > t.length) extra += y.length - t.length;
    if (i < s.w || s.allCommitted) {
      if (y.length < t.length) missed += t.length - y.length;
      if (y === t) wordsCorrect++;
      else wordsWrong++;
      if (i < last) {
        if (y.length >= t.length) spacesRight++;
        else spacesWrong++;
      }
    } else if (y.length > 0) {
      if (y === t) wordsCorrect++;
      else if (!t.startsWith(y)) wordsWrong++;
    }
  }
  const scoredChars = creditedChars(cfg, words, s);
  const wpmValue = wpmCx(scoredChars, elapsedMs);
  const rawValue = rawCx(insertions(s), elapsedMs);
  const accuracyValue = accuracyBp(s.correctKeys, s.wrongKeys);
  const finalValue = accuracyBp(correct + spacesRight, incorrect + extra + spacesWrong + missed);
  return {
    elapsedMs,
    wpm: wpmValue / 100,
    rawWpm: rawValue / 100,
    accuracy: accuracyValue / 100,
    wpmCx: wpmValue,
    rawCx: rawValue,
    accuracyBp: accuracyValue,
    finalTextAccuracy: finalValue / 100,
    finalTextBp: finalValue,
    correctKeys: s.correctKeys,
    wrongKeys: s.wrongKeys,
    repeatKeys: s.repeatKeys,
    deadKeys: s.deadKeys,
    backspaces: s.backspaces,
    ignored: s.ignored,
    wordsCorrect,
    wordsWrong,
    chars: { correct, incorrect, extra, missed },
    scoredChars,
  };
}
