import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type LogEntry, MAX_OPS, type Op } from '@/engine/core';
import { LOG_VERSION, decodeLog, encodeLog, maxLogBytes, maxLogBytesForWords } from '@/engine/log';
import { RUNS, arbRun, withHolds } from './arbitraries';

const v1 = (...bytes: number[]): Uint8Array => Uint8Array.from([LOG_VERSION, ...bytes]);

describe('log format version 1', () => {
  it('writes the frozen layout', () => {
    const entries: LogEntry[] = [
      { k: 'c', ch: 'a', t: 0, h: 0 },
      { k: 's', t: 100 },
      { k: 'b', t: 300, h: 80 },
      { k: 'w', t: 300 },
      { k: 'd', t: 301 },
      { k: 'c', ch: 'ã', t: 16685, h: 127 },
    ];
    expect([...encodeLog(entries)]).toEqual([
      1,
      0, 0x61 + 4, 1,
      100, 0, 0,
      0xc8, 0x01, 1, 81,
      0, 2, 0,
      1, 3, 0,
      0x80, 0x80, 0x01, 0xe7, 0x01, 0x80, 0x01,
    ]);
  });

  it('round-trips entries with holds exactly', () => {
    const arbHolds = fc.array(fc.option(fc.nat(100_000), { nil: undefined }), { minLength: 1, maxLength: 16 });
    fc.assert(
      fc.property(arbRun, arbHolds, ([, , o], holds) => {
        const entries = withHolds(o, holds);
        expect(decodeLog(encodeLog(entries))).toEqual(entries);
      }),
      RUNS,
    );
  });

  it('never throws on arbitrary bytes, and accepts only what it would write itself', () => {
    const anyBytes = fc.uint8Array({ maxLength: 200 });
    const versioned = anyBytes.map((b) => Uint8Array.from([LOG_VERSION, ...b]));
    // Random bytes rarely form a whole entry, so also fuzz around the valid logs.
    const mutated = fc.tuple(arbRun, fc.nat(), fc.nat(255)).map(([[, , o], at, byte]) => {
      const bytes = encodeLog(o);
      if (bytes.length > 1) bytes[1 + (at % (bytes.length - 1))] = byte;
      return bytes;
    });
    fc.assert(
      fc.property(fc.oneof(anyBytes, versioned, mutated), (bytes) => {
        const decoded = decodeLog(bytes);
        if (decoded !== null) expect([...encodeLog(decoded)]).toEqual([...bytes]);
      }),
      { numRuns: 3000 },
    );
  });

  it('rejects a wrong or missing version', () => {
    expect(decodeLog(new Uint8Array())).toBeNull();
    expect(decodeLog(Uint8Array.from([0]))).toBeNull();
    expect(decodeLog(Uint8Array.from([2, 0, 0, 0]))).toBeNull();
    expect(decodeLog(v1())).toEqual([]);
  });

  it('rejects truncated entries and varints', () => {
    expect(decodeLog(v1(0))).toBeNull();
    expect(decodeLog(v1(0, 0))).toBeNull();
    expect(decodeLog(v1(0x80))).toBeNull();
    expect(decodeLog(v1(0, 0x80))).toBeNull();
    expect(decodeLog(v1(0, 0, 0x80))).toBeNull();
  });

  it('rejects varints over 5 bytes and overlong encodings', () => {
    expect(decodeLog(v1(0x81, 0x80, 0x80, 0x80, 0x80, 0x01, 0, 0))).toBeNull();
    expect(decodeLog(v1(0x80, 0x00, 0, 0))).toBeNull();
    expect(decodeLog(v1(0, 0x80, 0x00, 0))).toBeNull();
  });

  it('rejects deltas beyond 2^31 and accepts 2^31 itself', () => {
    const at2p31 = v1(0x80, 0x80, 0x80, 0x80, 0x08, 0, 0);
    expect(decodeLog(at2p31)).toEqual([{ k: 's', t: 2147483648 }]);
    expect(decodeLog(v1(0x81, 0x80, 0x80, 0x80, 0x08, 0, 0))).toBeNull();
  });

  it('rejects surrogate, control, space and out-of-range units', () => {
    const token = (unit: number): number[] => {
      const out: number[] = [];
      let x = unit + 4;
      while (x >= 0x80) {
        out.push((x % 0x80) | 0x80);
        x = Math.floor(x / 0x80);
      }
      out.push(x);
      return out;
    };
    for (const unit of [0xd800, 0xdbff, 0xdc00, 0xdfff, 0x00, 0x0a, 0x1f, 0x20, 0x7f, 0x80, 0x9f, 0x10000]) {
      expect(decodeLog(v1(0, ...token(unit), 0)), unit.toString(16)).toBeNull();
    }
    expect(decodeLog(v1(0, ...token(0xe3), 0))).toEqual([{ k: 'c', ch: 'ã', t: 0 }]);
    expect(decodeLog(v1(0, ...token(0xffff), 0))).toEqual([{ k: 'c', ch: '￿', t: 0 }]);
  });

  it('rejects too many entries', () => {
    const entry = [0, 0, 0];
    const ok = new Uint8Array(1 + MAX_OPS * entry.length);
    ok[0] = LOG_VERSION;
    expect(decodeLog(ok)).toHaveLength(MAX_OPS);
    const over = new Uint8Array(1 + (MAX_OPS + 1) * entry.length);
    over[0] = LOG_VERSION;
    expect(decodeLog(over)).toBeNull();
  });

  it('encodeLog refuses what the format cannot hold', () => {
    const bad: Op[][] = [
      [{ k: 'c', ch: 'ab', t: 0 }],
      [{ k: 'c', ch: '\n', t: 0 }],
      [{ k: 's', t: 5 }, { k: 's', t: 4 }],
      [{ k: 's', t: 0.5 }],
      [{ k: 's', t: 2 ** 31 + 1 }],
    ];
    for (const entries of bad) expect(() => encodeLog(entries)).toThrow(RangeError);
    expect(() => encodeLog([{ k: 's', t: 0, h: -1 }])).toThrow(RangeError);
    expect(() => encodeLog([{ k: 's', t: 0, h: -2 }])).toThrow(RangeError);
    expect(() => encodeLog([{ k: 's', t: 0, h: 2 ** 31 }])).toThrow(RangeError);
    expect(() => encodeLog([{ k: 's', t: 0, h: 1.5 }])).toThrow(RangeError);
  });

  it('keeps the largest hold the format can hold', () => {
    const entries: LogEntry[] = [{ k: 's', t: 0, h: 2 ** 31 - 1 }];
    expect(decodeLog(encodeLog(entries))).toEqual(entries);
  });

  it('caps sizes as the plan says', () => {
    expect(maxLogBytes(60_000)).toBe(13_024);
    expect(maxLogBytes(120_000)).toBe(25_024);
    expect(maxLogBytesForWords(100)).toBe(5_024);
  });

  it('a heavy Portuguese minute fits the cap', () => {
    const entries: LogEntry[] = [];
    let t = 0;
    for (let i = 0; i < 2000; i++) {
      t += 30;
      entries.push({ k: 'c', ch: 'ã', t, h: 90 });
    }
    expect(encodeLog(entries).length).toBeLessThan(maxLogBytes(60_000));
  });
});
