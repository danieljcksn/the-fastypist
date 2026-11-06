import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { challengeDay, msUntilNextDay } from '@/engine/day';
import { RUNS } from './arbitraries';

const utc = (iso: string): number => Date.parse(iso);

describe('challengeDay', () => {
  it('turns over at exactly 06:00 UTC', () => {
    expect(challengeDay(utc('2026-11-06T05:59:59.999Z'))).toBe('2026-11-05');
    expect(challengeDay(utc('2026-11-06T06:00:00.000Z'))).toBe('2026-11-06');
  });

  it('crosses year ends', () => {
    expect(challengeDay(utc('2027-01-01T05:59:59.999Z'))).toBe('2026-12-31');
    expect(challengeDay(utc('2027-01-01T06:00:00.000Z'))).toBe('2027-01-01');
  });

  it('crosses leap days, including the century rules', () => {
    expect(challengeDay(utc('2028-02-29T05:59:59.999Z'))).toBe('2028-02-28');
    expect(challengeDay(utc('2028-02-29T06:00:00.000Z'))).toBe('2028-02-29');
    expect(challengeDay(utc('2028-03-01T05:59:59.999Z'))).toBe('2028-02-29');
    expect(challengeDay(utc('2028-03-01T06:00:00.000Z'))).toBe('2028-03-01');
    expect(challengeDay(utc('2027-03-01T05:59:59.999Z'))).toBe('2027-02-28');
    expect(challengeDay(utc('2000-02-29T12:00:00.000Z'))).toBe('2000-02-29');
    expect(challengeDay(utc('2100-03-01T05:00:00.000Z'))).toBe('2100-02-28');
  });

  it('handles the epoch and before it', () => {
    expect(challengeDay(0)).toBe('1969-12-31');
    expect(challengeDay(21_600_000)).toBe('1970-01-01');
    expect(challengeDay(-1)).toBe('1969-12-31');
  });

  it('refuses what YYYY-MM-DD cannot write, rather than formatting it badly', () => {
    for (const bad of [Number.NaN, Infinity, -Infinity, Date.UTC(-1, 5, 14, 12), Date.UTC(10_000, 0, 2)]) {
      expect(() => challengeDay(bad), String(bad)).toThrow(RangeError);
    }
    const yearZero = new Date(0);
    yearZero.setUTCFullYear(0, 5, 14);
    expect(challengeDay(yearZero.getTime() + 43_200_000)).toBe('0000-06-14');
    const yearMax = new Date(0);
    yearMax.setUTCFullYear(9999, 11, 31);
    expect(challengeDay(yearMax.getTime() + 43_200_000)).toBe('9999-12-31');
  });

  it('agrees with Date across two millennia', () => {
    const arbMs = fc.integer({ min: utc('1000-01-01T00:00:00Z'), max: utc('3000-12-31T23:59:59Z') });
    fc.assert(
      fc.property(arbMs, (ms) => challengeDay(ms) === new Date(ms - 21_600_000).toISOString().slice(0, 10)),
      RUNS,
    );
  });
});

describe('msUntilNextDay', () => {
  it('counts down to the next 06:00 UTC', () => {
    expect(msUntilNextDay(utc('2026-11-06T05:59:59.999Z'))).toBe(1);
    expect(msUntilNextDay(utc('2026-11-06T06:00:00.000Z'))).toBe(86_400_000);
    expect(msUntilNextDay(utc('2026-11-06T12:00:00.000Z'))).toBe(64_800_000);
    expect(msUntilNextDay(-1)).toBe(21_600_001);
  });

  it('refuses a clock that is not a number', () => {
    for (const bad of [Number.NaN, Infinity, -Infinity]) expect(() => msUntilNextDay(bad), String(bad)).toThrow(RangeError);
  });

  it('always lands exactly on the next day', () => {
    fc.assert(
      fc.property(fc.integer({ min: -4_000_000_000_000, max: 8_000_000_000_000 }), (ms) => {
        const left = msUntilNextDay(ms);
        return (
          left >= 1 &&
          left <= 86_400_000 &&
          challengeDay(ms + left - 1) === challengeDay(ms) &&
          challengeDay(ms + left) !== challengeDay(ms)
        );
      }),
      RUNS,
    );
  });
});
