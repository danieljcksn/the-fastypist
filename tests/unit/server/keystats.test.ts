import { describe, expect, it } from 'vitest';
import type { LogEntry } from '@/engine/core';
import { PACK_IDS, PACKS } from '@/engine/packs';
import { findPack } from '@/engine/packs/server';
import { configFor } from '@/engine/presets';
import { countKeys, decodeCounts, keyAlphabet, mergeCounts, weekStartOf } from '@/server/keystats';

const CONFIG = configFor({ kind: 'time', seconds: 60 });

describe('key stats', () => {
  it('has every letter of every pack in its language’s alphabet', () => {
    for (const id of PACK_IDS) {
      const alphabet = keyAlphabet(PACKS[id].language);
      for (const word of findPack(id)?.words ?? []) for (const ch of word) expect(alphabet, `${id}: ${word}`).toContain(ch);
    }
  });

  it('has an alphabet that only grows at the end', () => {
    expect(keyAlphabet('en')).toBe(' abcdefghijklmnopqrstuvwxyz');
    expect(keyAlphabet('pt').startsWith(keyAlphabet('en'))).toBe(true);
    expect(keyAlphabet('pt')).toHaveLength(40);
  });

  it('counts hits and misses by target letter, not by what was pressed', () => {
    const entries: LogEntry[] = [
      { k: 'c', ch: 'c', t: 0 },
      { k: 'c', ch: 'x', t: 1 },
      { k: 'b', t: 2 },
      { k: 'c', ch: 'a', t: 3 },
      { k: 's', t: 4 },
      { k: 'c', ch: 'd', t: 5 },
      { k: 's', t: 6 },
    ];
    const counts = decodeCounts(countKeys(CONFIG, ['ca', 'do', 'e'], entries, 'en'), 'en');
    expect(counts).toEqual([
      { key: ' ', hits: 1, misses: 1 },
      { key: 'a', hits: 1, misses: 1 },
      { key: 'c', hits: 1, misses: 0 },
      { key: 'd', hits: 1, misses: 0 },
    ]);
  });

  it('ignores letters past the end of a word', () => {
    const entries: LogEntry[] = [
      { k: 'c', ch: 'a', t: 0 },
      { k: 'c', ch: 'z', t: 1 },
    ];
    expect(decodeCounts(countKeys(CONFIG, ['a', 'b'], entries, 'en'), 'en')).toEqual([{ key: 'a', hits: 1, misses: 0 }]);
  });

  it('merges by adding, and saturates rather than wrapping', () => {
    const a = Buffer.alloc(8);
    a.writeUInt16BE(65000, 0);
    a.writeUInt16BE(2, 2);
    const b = Buffer.alloc(8);
    b.writeUInt16BE(1000, 0);
    b.writeUInt16BE(3, 2);
    const merged = mergeCounts(a, b);
    expect(merged.readUInt16BE(0)).toBe(65535);
    expect(merged.readUInt16BE(2)).toBe(5);
  });

  it('merges a row written before the alphabet grew', () => {
    const old = Buffer.alloc(4);
    old.writeUInt16BE(5, 0);
    const longer = Buffer.alloc(8);
    longer.writeUInt16BE(1, 0);
    longer.writeUInt16BE(7, 4);
    const merged = mergeCounts(old, longer);
    expect(merged.length).toBe(8);
    expect(merged.readUInt16BE(0)).toBe(6);
    expect(merged.readUInt16BE(4)).toBe(7);
  });

  it('weeks start on Monday', () => {
    expect(weekStartOf('2026-11-06')).toBe('2026-11-02');
    expect(weekStartOf('2026-11-02')).toBe('2026-11-02');
    expect(weekStartOf('2026-11-01')).toBe('2026-10-26');
  });
});
