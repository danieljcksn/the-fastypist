export interface Config {
  mode: 'time' | 'words';
  /** Time mode only; ignored in words mode. */
  durationMs: number;
  stopOn: 'none' | 'word' | 'letter';
  /** Extra letters accepted past a word's end. */
  maxExtra: number;
  /** Whether an empty word may step back into a wrong previous word. */
  backspace: 'incorrect-only' | 'never';
}

export const MAX_EXTRA = 8;

// Log and replay share this bound. At 2^31 per delta, accumulated time stays under 2^47, safely inside doubles.
export const MAX_OPS = 65536;

// 100 words at 5 WPM. A choice: long enough for anyone honest, short enough to bound a forged log.
export const WORDS_MAX_ELAPSED_MS = 1_200_000;

export type Op =
  | { k: 'c'; ch: string; t: number }
  | { k: 's'; t: number }
  | { k: 'b'; t: number }
  | { k: 'w'; t: number }
  | { k: 'd'; t: number };

/** h is the keyup hold in ms. It is display and integrity data and never reaches the scorer. */
export type LogEntry = Op & { h?: number };

export type Phase = 'idle' | 'running' | 'finished';

export interface State {
  phase: Phase;
  startT: number;
  endT: number;
  lastT: number;
  w: number;
  /** typed[i] for 0..=w; later words have no entry. */
  typed: string[];
  /** The last word was exactly typed or committed, so its letters are final rather than cut off by the clock. */
  allCommitted: boolean;
  correctKeys: number;
  wrongKeys: number;
  /** A right key at a slot that already earned its correct key. Raw counts it, accuracy does not. */
  repeatKeys: number;
  /** credited[w][i]: that slot has earned its correct key. The slot after a word's last letter is its space. Outlives typed. */
  credited: boolean[][];
  deadKeys: number;
  backspaces: number;
  /** Ops with no effect: space on an empty word, backspace on a locked word. */
  ignored: number;
}

export type Change =
  | { c: 'none' }
  | { c: 'letter'; w: number; i: number; ok: boolean; extra: boolean }
  | { c: 'erase'; w: number; i: number; extra: boolean }
  | { c: 'eraseWord'; w: number }
  | { c: 'commit'; w: number; correct: boolean; missed: number }
  | { c: 'back'; w: number };

export const NONE: Change = { c: 'none' };

export function init(): State {
  return {
    phase: 'idle',
    startT: 0,
    endT: 0,
    lastT: 0,
    w: 0,
    typed: [''],
    allCommitted: false,
    correctKeys: 0,
    wrongKeys: 0,
    repeatKeys: 0,
    credited: [],
    deadKeys: 0,
    backspaces: 0,
    ignored: 0,
  };
}

/** One UTF-16 unit a key can legally produce. Space has its own op, so a space here would be a second encoding of it. */
export function isTypableUnit(code: number): boolean {
  if (code <= 0x20 || code === 0x7f) return false;
  if (code >= 0x80 && code <= 0x9f) return false;
  return code < 0xd800 || code > 0xdfff;
}

export function expiresAt(cfg: Config, s: State): number {
  return cfg.mode === 'time' && s.phase !== 'idle' ? s.startT + cfg.durationMs : Infinity;
}

/** Closes a time run whose deadline passed with no further key: a timer calls this, and so does replay. */
export function expire(cfg: Config, s: State): void {
  if (cfg.mode === 'time' && s.phase === 'running') {
    s.phase = 'finished';
    s.endT = s.startT + cfg.durationMs;
  }
}

function canReturn(cfg: Config, words: readonly string[], s: State): boolean {
  return cfg.backspace === 'incorrect-only' && s.w > 0 && s.typed[s.w - 1] !== words[s.w - 1];
}

/** I in the scoring formulas: every character or space that reached a word, deleted later or not. */
export function insertions(s: State): number {
  return s.correctKeys + s.wrongKeys + s.repeatKeys;
}

// One correct key per slot per run. Otherwise a right key and its deletion buy accuracy forever, at the same rate whether
// the key is a letter or the space re-committing a wrong word, and the 85% gate stops meaning anything. Decided here rather
// than in engine.md section 4, which permits it literally.
function pressRight(s: State, slot: number): void {
  let slots = s.credited[s.w];
  if (slots === undefined) {
    slots = [];
    s.credited[s.w] = slots;
  }
  if (slots[slot]) {
    s.repeatKeys++;
  } else {
    slots[slot] = true;
    s.correctKeys++;
  }
}

/** Mutates s, which has one owner. The result depends only on (cfg, words, s, op). */
export function step(cfg: Config, words: readonly string[], s: State, op: Op): Change {
  if (s.phase === 'finished') return NONE;
  if (s.phase === 'running' && cfg.mode === 'time' && op.t >= s.startT + cfg.durationMs) {
    s.phase = 'finished';
    s.endT = s.startT + cfg.durationMs;
    return NONE;
  }
  const target = words[s.w];
  const cur = s.typed[s.w];
  if (target === undefined || cur === undefined) return NONE;
  const last = s.w === words.length - 1;

  switch (op.k) {
    case 'c': {
      if (s.phase === 'idle') {
        s.phase = 'running';
        s.startT = op.t;
      }
      s.lastT = op.t;
      const i = cur.length;
      if (i >= target.length) {
        s.wrongKeys++;
        if (cfg.stopOn === 'letter' || i - target.length >= cfg.maxExtra) return NONE;
        s.typed[s.w] = cur + op.ch;
        return { c: 'letter', w: s.w, i, ok: false, extra: true };
      }
      const ok = target.charCodeAt(i) === op.ch.charCodeAt(0);
      if (ok) pressRight(s, i);
      else s.wrongKeys++;
      if (!ok && cfg.stopOn === 'letter') return NONE;
      const next = cur + op.ch;
      s.typed[s.w] = next;
      if (last && next === target) {
        // In time mode this means the text ran out. T stays the mode's duration, so finishing early gains nothing.
        s.phase = 'finished';
        s.endT = op.t;
        s.allCommitted = true;
      }
      return { c: 'letter', w: s.w, i, ok, extra: false };
    }
    case 's': {
      if (s.phase === 'idle' || cur.length === 0) {
        s.ignored++;
        return NONE;
      }
      s.lastT = op.t;
      const correct = cur === target;
      if (!correct && cfg.stopOn !== 'none') {
        s.wrongKeys++;
        return NONE;
      }
      if (cur.length >= target.length) pressRight(s, target.length);
      else s.wrongKeys++;
      const missed = cur.length < target.length ? target.length - cur.length : 0;
      const w = s.w;
      if (last) {
        s.phase = 'finished';
        s.endT = op.t;
        s.allCommitted = true;
      } else {
        s.w = w + 1;
        s.typed.push('');
      }
      return { c: 'commit', w, correct, missed };
    }
    case 'b': {
      if (s.phase === 'idle') {
        s.ignored++;
        return NONE;
      }
      if (cur.length > 0) {
        s.lastT = op.t;
        s.backspaces++;
        const i = cur.length - 1;
        s.typed[s.w] = cur.slice(0, i);
        return { c: 'erase', w: s.w, i, extra: i >= target.length };
      }
      if (canReturn(cfg, words, s)) {
        s.lastT = op.t;
        s.backspaces++;
        s.typed.pop();
        s.w--;
        return { c: 'back', w: s.w };
      }
      s.ignored++;
      return NONE;
    }
    case 'w': {
      if (s.phase === 'idle') {
        s.ignored++;
        return NONE;
      }
      if (cur.length > 0) {
        s.lastT = op.t;
        s.backspaces++;
        s.typed[s.w] = '';
        return { c: 'eraseWord', w: s.w };
      }
      if (canReturn(cfg, words, s)) {
        s.lastT = op.t;
        s.backspaces++;
        s.typed.pop();
        s.w--;
        s.typed[s.w] = '';
        return { c: 'eraseWord', w: s.w };
      }
      s.ignored++;
      return NONE;
    }
    case 'd': {
      if (s.phase === 'idle') {
        s.phase = 'running';
        s.startT = op.t;
      }
      s.lastT = op.t;
      s.deadKeys++;
      return NONE;
    }
  }
}

export type LetterStatus = 'pending' | 'correct' | 'wrong' | 'extra' | 'missed';

export function letterStatus(words: readonly string[], s: State, w: number, i: number): LetterStatus {
  if (w > s.w) return 'pending';
  const t = words[w] ?? '';
  const y = s.typed[w] ?? '';
  if (i >= t.length) return i < y.length ? 'extra' : 'pending';
  if (i < y.length) return t.charCodeAt(i) === y.charCodeAt(i) ? 'correct' : 'wrong';
  return w < s.w || s.allCommitted ? 'missed' : 'pending';
}
