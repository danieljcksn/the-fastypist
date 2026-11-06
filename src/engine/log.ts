import { type LogEntry, MAX_OPS, isTypableUnit } from './core';

// Format version 1 is frozen: stored and in-flight logs must replay forever, so a change means a new version byte.
// Layout: version byte, then per entry varint delta-t, varint token, varint hold+1 (0 means no keyup seen).
// Tokens: 0 space, 1 backspace, 2 word delete, 3 dead key, otherwise UTF-16 unit + 4.

export const LOG_VERSION = 1;

const MAX_DELTA = 2_147_483_648;
const MAX_TOKEN = 0xffff + 4;
const MAX_VARINT_BYTES = 5;

export function maxLogBytes(durationMs: number): number {
  return 1024 + 200 * Math.ceil(durationMs / 1000);
}

export function maxLogBytesForWords(wordCount: number): number {
  return 1024 + 40 * wordCount;
}

function pushVarint(out: number[], value: number): void {
  // Division rather than >>: a delta of 2^31 overflows the 32-bit shift operators.
  let x = value;
  while (x >= 0x80) {
    out.push((x % 0x80) | 0x80);
    x = Math.floor(x / 0x80);
  }
  out.push(x);
}

function tokenOf(e: LogEntry): number {
  switch (e.k) {
    case 's':
      return 0;
    case 'b':
      return 1;
    case 'w':
      return 2;
    case 'd':
      return 3;
    case 'c': {
      const unit = e.ch.charCodeAt(0);
      if (e.ch.length !== 1 || !isTypableUnit(unit)) throw new RangeError('log entry has an untypable character');
      return unit + 4;
    }
  }
}

/** Throws RangeError on an entry the format cannot hold: that is a capture bug, and hiding it would corrupt the log. */
export function encodeLog(entries: readonly LogEntry[]): Uint8Array {
  if (entries.length > MAX_OPS) throw new RangeError('log has too many entries');
  const out: number[] = [LOG_VERSION];
  let prev = 0;
  for (const e of entries) {
    const delta = e.t - prev;
    if (!Number.isSafeInteger(e.t) || delta < 0 || delta > MAX_DELTA) throw new RangeError('log entry has an invalid time');
    if (e.h !== undefined && (!Number.isSafeInteger(e.h) || e.h < 0 || e.h >= MAX_DELTA)) {
      throw new RangeError('log entry has an invalid hold');
    }
    pushVarint(out, delta);
    pushVarint(out, tokenOf(e));
    pushVarint(out, e.h === undefined ? 0 : e.h + 1);
    prev = e.t;
  }
  return Uint8Array.from(out);
}

/** Strict on purpose: returns null for anything encodeLog would not have written, overlong varints included. */
export function decodeLog(bytes: Uint8Array): LogEntry[] | null {
  if (bytes[0] !== LOG_VERSION) return null;
  let p = 1;
  const readVarint = (): number => {
    let value = 0;
    let scale = 1;
    for (let n = 0; n < MAX_VARINT_BYTES; n++) {
      const byte = bytes[p++];
      if (byte === undefined) return -1;
      value += (byte & 0x7f) * scale;
      if (byte < 0x80) return n > 0 && byte === 0 ? -1 : value;
      scale *= 0x80;
    }
    return -1;
  };
  const entries: LogEntry[] = [];
  let t = 0;
  while (p < bytes.length) {
    if (entries.length === MAX_OPS) return null;
    const delta = readVarint();
    if (delta < 0 || delta > MAX_DELTA) return null;
    const token = readVarint();
    if (token < 0 || token > MAX_TOKEN) return null;
    const hold = readVarint();
    if (hold < 0 || hold > MAX_DELTA) return null;
    t += delta;
    let entry: LogEntry;
    if (token === 0) entry = { k: 's', t };
    else if (token === 1) entry = { k: 'b', t };
    else if (token === 2) entry = { k: 'w', t };
    else if (token === 3) entry = { k: 'd', t };
    else {
      const unit = token - 4;
      if (!isTypableUnit(unit)) return null;
      entry = { k: 'c', ch: String.fromCharCode(unit), t };
    }
    if (hold > 0) entry.h = hold - 1;
    entries.push(entry);
  }
  return entries;
}
