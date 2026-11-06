import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeLog } from '@/engine/log';
import { replay } from '@/engine/replay';
import { RANKED_PACK } from '@/engine/packs';
import { encodeSubmission } from '@/server/frame';
import { issueTicket } from '@/server/tickets';
import {
  type Prepared,
  MAX_BODY_BYTES,
  configOf,
  failedGates,
  flightLog,
  judgeRetry,
  prepareSubmission,
  readCapped,
  verifyRun,
  wordsOf,
} from '@/server/verify';
import { PLAUSIBILITY_FIXTURE } from './helpers/fixtures';
import { constantShape, humanShape } from './helpers/logs';
import { type BuildOptions, SECRET, buildRun, rankedRequest } from './helpers/submissions';

const AFTER = 70_000;
const IAT = 1_800_000_000_000;

function prepared(options: BuildOptions = {}): Prepared {
  const out = prepareSubmission(buildRun(options).body);
  if (!out.ok) throw new Error(out.reason);
  return out.prepared;
}

describe('verification', () => {
  const saved = process.env.TICKET_SECRETS;
  beforeAll(() => {
    process.env.TICKET_SECRETS = SECRET;
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.TICKET_SECRETS;
    else process.env.TICKET_SECRETS = saved;
  });

  describe('reading the body', () => {
    const stream = (chunks: Uint8Array[]): ReadableStream<Uint8Array> =>
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      });

    it('joins chunks under the cap', async () => {
      const out = await readCapped(stream([Uint8Array.of(1, 2), Uint8Array.of(3)]), 3);
      expect([...(out ?? [])]).toEqual([1, 2, 3]);
    });

    it('stops at the cap while reading, without taking the rest', async () => {
      let pulled = 0;
      const endless = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled++;
          controller.enqueue(new Uint8Array(1024));
        },
      });
      expect(await readCapped(endless, 4096)).toBeNull();
      expect(pulled).toBeLessThan(10);
    });

    it('reads a missing body as empty', async () => {
      expect(await readCapped(null)).toEqual(new Uint8Array(0));
    });
  });

  describe('strict decoding', () => {
    const good = (): ReturnType<typeof buildRun> => buildRun();

    it('accepts a good body and hashes exactly the log', () => {
      const run = good();
      const out = prepareSubmission(run.body);
      expect(out.ok).toBe(true);
      if (out.ok) expect(out.prepared.bodyHash.toString('hex')).toBe(createHash('sha256').update(run.log).digest('hex'));
    });

    it.each([
      ['empty', new Uint8Array(0)],
      ['wrong version', Uint8Array.of(2, 0, 2, 0x7b, 0x7d)],
      ['a meta length past the end', Uint8Array.of(1, 0xff, 0xff, 0x7b)],
      ['meta that is not JSON', Uint8Array.of(1, 0, 1, 0x7b)],
      ['meta that is not UTF-8', Uint8Array.of(1, 0, 2, 0xff, 0xfe)],
      ['empty meta object', Uint8Array.of(1, 0, 2, 0x7b, 0x7d)],
    ])('rejects %s', (_name, bytes) => {
      expect(prepareSubmission(bytes)).toEqual({ ok: false, reason: 'malformed' });
    });

    it('refuses any body that carries a number of its own', () => {
      const run = good();
      const meta = { ticket: run.token, start: null, end: null, device: 'keyboard', timeZone: 'UTC', confirms: null, wpm: 999 };
      const text = new TextEncoder().encode(JSON.stringify(meta));
      const body = new Uint8Array(3 + text.length);
      body[0] = 1;
      new DataView(body.buffer).setUint16(1, text.length);
      body.set(text, 3);
      expect(prepareSubmission(body)).toEqual({ ok: false, reason: 'malformed' });
    });

    it('rejects a body over the absolute cap', () => {
      expect(prepareSubmission(new Uint8Array(MAX_BODY_BYTES + 1))).toEqual({ ok: false, reason: 'too-large' });
    });

    it('rejects a log over its ticket’s cap', () => {
      const run = buildRun({ request: { language: 'en', pack: RANKED_PACK.en, mode: 'words', amount: 10 } });
      const huge = encodeSubmission(
        { ticket: run.token, start: null, end: null, device: 'keyboard', timeZone: 'UTC', confirms: null },
        new Uint8Array(1024 + 40 * 10 + 1),
      );
      const out = prepareSubmission(huge);
      if (!out.ok) throw new Error(out.reason);
      expect(verifyRun(out.prepared, IAT + AFTER, null)).toEqual({ ok: false, reason: 'too-large' });
    });

    it('passes a ticket failure through as the reason', () => {
      const run = good();
      const forged = encodeSubmission(
        {
          ticket: `k1.${run.token.split('.')[1]}.${'A'.repeat(43)}`,
          start: null,
          end: null,
          device: 'keyboard',
          timeZone: 'UTC',
          confirms: null,
        },
        run.log,
      );
      expect(prepareSubmission(forged)).toEqual({ ok: false, reason: 'bad-signature' });
    });
  });

  describe('replay', () => {
    it('scores from the log and nothing else', () => {
      const p = prepared();
      const out = verifyRun(p, IAT + AFTER, null);
      if (!out.ok) throw new Error(out.reason);
      const words = wordsOf(p.ticket) ?? [];
      const direct = replay(configOf(p.ticket), words, decodeLog(p.log) ?? []);
      expect(out.run.score).toEqual(direct.score);
      expect(out.run.score.wpmCx).toBeGreaterThan(9000);
      expect(out.run.status).toBe('passed');
    });

    it('rejects a log that does not decode', () => {
      const run = buildRun();
      const body = encodeSubmission(
        { ticket: run.token, start: null, end: null, device: 'keyboard', timeZone: 'UTC', confirms: null },
        Uint8Array.of(9, 9, 9),
      );
      const out = prepareSubmission(body);
      if (!out.ok) throw new Error(out.reason);
      expect(verifyRun(out.prepared, IAT + AFTER, null)).toEqual({ ok: false, reason: 'bad-log' });
    });

    it('rejects a run with no keys', () => {
      expect(verifyRun(prepared({ entries: [] }), IAT + AFTER, null)).toEqual({ ok: false, reason: 'replay-failed' });
    });

    it('rejects an unfinished words run', () => {
      const request = { language: 'en', pack: RANKED_PACK.en, mode: 'words', amount: 10 } as const;
      const p = prepared({ request, entries: [{ k: 'c', ch: 'a', t: 0 }] });
      expect(verifyRun(p, IAT + AFTER, null)).toEqual({ ok: false, reason: 'replay-failed' });
    });

    it('rejects a scorer this build does not have', () => {
      const p = prepared();
      expect(verifyRun({ ...p, ticket: { ...p.ticket, scorer: 99 } }, IAT + AFTER, null)).toEqual({ ok: false, reason: 'unknown-scorer' });
    });

    it('reproduces the text from the ticket alone', () => {
      const { ticket } = issueTicket(rankedRequest('pt'), IAT);
      expect(wordsOf(ticket)).toEqual(wordsOf(ticket));
      expect(wordsOf(ticket)).toHaveLength(600);
      expect(wordsOf({ ...ticket, mode: 'words', amount: 25 })).toHaveLength(25);
    });

    it('drops keys typed past the deadline', () => {
      const p = prepared({ mapEntries: (e) => [...e, { k: 'c', ch: 'z', t: 90_000 }] });
      const out = verifyRun(p, IAT + AFTER, null);
      if (!out.ok) throw new Error(out.reason);
      expect(out.run.entries.at(-1)?.t).toBeLessThan(60_000);
    });
  });

  describe('time, judged on stamps', () => {
    const config = PLAUSIBILITY_FIXTURE;
    const fast = { shape: humanShape(170) };

    it('rejects a run that arrives before it could have finished', () => {
      expect(verifyRun(prepared(), IAT + 5_000, null)).toEqual({ ok: false, reason: 'too-early' });
      expect(verifyRun(prepared(), IAT + 58_400, null).ok).toBe(false);
      expect(verifyRun(prepared(), IAT + 58_600, null).ok).toBe(true);
    });

    it('passes a fast run with good stamps, however late it arrives', () => {
      for (const delay of [0, 3_600_000, 86_400_000 * 5]) {
        const out = verifyRun(prepared(fast), IAT + AFTER + delay, config);
        if (!out.ok) throw new Error(out.reason);
        expect(out.run.status, `delay ${delay}`).toBe('passed');
        expect(out.run.finishedAtMs).toBe(IAT + 61_000);
      }
    });

    it('downgrades a late end stamp and never rejects it', () => {
      const out = verifyRun(prepared({ ...fast, endAfter: 1000 + 60_000 + config.stampLateMs + 1 }), IAT + AFTER + 9000, config);
      if (!out.ok) throw new Error(out.reason);
      expect(out.run.status).toBe('unverified');
      expect(out.run.reasons).toEqual(['stamp-long']);
    });

    it('downgrades a late start stamp, which makes the span short', () => {
      const out = verifyRun(prepared({ ...fast, startAfter: 1000 + config.stampEarlyMs + 1, endAfter: 61_000 }), IAT + AFTER, config);
      if (!out.ok) throw new Error(out.reason);
      expect(out.run.status).toBe('unverified');
      expect(out.run.reasons).toEqual(['stamp-short']);
    });

    it('holds a fast run with a stamp missing', () => {
      for (const missing of [{ startAfter: null }, { endAfter: null }]) {
        const out = verifyRun(prepared({ ...fast, ...missing }), IAT + AFTER, config);
        if (!out.ok) throw new Error(out.reason);
        expect(out.run.status).toBe('held');
        expect(out.run.reasons).toContain('stamp-missing');
      }
    });

    it('treats a forged stamp as no stamp', () => {
      const body = buildRun({ ...fast, meta: { start: 'k1.e30.AAAA', end: null } }).body;
      const out = prepareSubmission(body);
      if (!out.ok) throw new Error(out.reason);
      const verified = verifyRun(out.prepared, IAT + AFTER, config);
      if (!verified.ok) throw new Error(verified.reason);
      expect(verified.run.startMs).toBeNull();
      expect(verified.run.status).toBe('held');
    });

    it('ignores stamps entirely under the gate', () => {
      const out = verifyRun(prepared({ startAfter: null, endAfter: null }), IAT + AFTER, config);
      if (!out.ok) throw new Error(out.reason);
      expect(out.run.status).toBe('passed');
    });

    it('downgrades an expired ticket with no proof of a timely start, at any speed', () => {
      const out = verifyRun(prepared({ startAfter: null, endAfter: null }), IAT + 21 * 60_000, null);
      if (!out.ok) throw new Error(out.reason);
      expect(out.run.status).toBe('unverified');
      expect(out.run.reasons).toEqual(['ticket-expired']);
    });

    it('accepts an expired ticket with a start stamp, because the start was in time', () => {
      const out = verifyRun(prepared(), IAT + 21 * 60_000, null);
      if (!out.ok) throw new Error(out.reason);
      expect(out.run.status).toBe('passed');
    });

    it('holds a robot, and a hold outranks a downgrade', () => {
      const out = verifyRun(prepared({ shape: constantShape(170), endAfter: 90_000 }), IAT + 100_000, config);
      if (!out.ok) throw new Error(out.reason);
      expect(out.run.status).toBe('held');
      expect(out.run.reasons).toContain('iki-cv');
      expect(out.run.reasons).toContain('stamp-long');
    });

    it('holds but does not reject a log claiming an impossible speed with no configuration', () => {
      const forged = prepared({
        mapEntries: (_entries, words) =>
          [...words.join(' ')].slice(0, 3000).map((ch) => (ch === ' ' ? { k: 's' as const, t: 0 } : { k: 'c' as const, ch, t: 0 })),
      });
      const out = verifyRun(forged, IAT + AFTER, null);
      if (!out.ok) throw new Error(out.reason);
      expect(out.run.status).toBe('held');
      expect(out.run.reasons).toEqual(['ceiling']);
    });
  });

  describe('the local day', () => {
    it('is the typist’s, stamped from the finish time', () => {
      const iat = Date.UTC(2026, 10, 7, 1, 0, 0);
      const out = verifyRun(prepared({ iat, meta: { timeZone: 'America/Sao_Paulo' } }), iat + AFTER, null);
      if (!out.ok) throw new Error(out.reason);
      expect(out.run.localDay).toBe('2026-11-06');
    });

    it('falls back to UTC on a zone that does not exist', () => {
      const iat = Date.UTC(2026, 10, 7, 1, 0, 0);
      const out = verifyRun(prepared({ iat, meta: { timeZone: 'Mars/Olympus' } }), iat + AFTER, null);
      if (!out.ok) throw new Error(out.reason);
      expect(out.run.localDay).toBe('2026-11-07');
    });
  });

  describe('retries', () => {
    const hash = Buffer.from('a'.repeat(64), 'hex');
    it('is a retry only for the same user and the same bytes', () => {
      expect(judgeRetry({ profileId: 1, bodyHash: hash }, 1, hash)).toBe('same');
      expect(judgeRetry({ profileId: 1, bodyHash: hash }, 2, hash)).toBe('conflict');
      expect(judgeRetry({ profileId: 1, bodyHash: hash }, 1, Buffer.from('b'.repeat(64), 'hex'))).toBe('conflict');
      expect(judgeRetry({ profileId: 1, bodyHash: null }, 1, hash)).toBe('conflict');
    });
  });

  describe('eligibility', () => {
    const profile = { username: 'ana', rankingConsentAt: new Date(), bannedAt: null };
    const run = (over: Partial<BuildOptions> = {}) => {
      const out = verifyRun(prepared(over), IAT + AFTER, null);
      if (!out.ok) throw new Error(out.reason);
      return out.run;
    };

    it('passes the plan’s ranked run', () => {
      expect(failedGates(run(), profile)).toEqual([]);
    });

    it('names each gate that fails', () => {
      expect(failedGates(run(), { ...profile, username: null })).toEqual(['no-username']);
      expect(failedGates(run(), { ...profile, rankingConsentAt: null })).toEqual(['no-consent']);
      expect(failedGates(run(), { ...profile, bannedAt: new Date() })).toEqual(['banned']);
      expect(failedGates(run({ meta: { device: 'touch' } }), profile)).toEqual(['touch-keyboard']);
      expect(failedGates(run({ request: { language: 'en', pack: 'en-5k@1', mode: 'time', amount: 60 } }), profile)).toEqual([
        'list-not-ranked',
      ]);
      expect(failedGates(run({ request: { ...rankedRequest(), amount: 30 } }), profile)).toEqual(['not-sixty-seconds']);
    });

    it('holds the accuracy gate at 85% exactly', () => {
      const base = run();
      expect(failedGates({ ...base, score: { ...base.score, accuracyBp: 8500 } }, profile)).toEqual([]);
      expect(failedGates({ ...base, score: { ...base.score, accuracyBp: 8499 } }, profile)).toEqual(['low-accuracy']);
    });
  });

  describe('what may be stored', () => {
    it('strips every hold from the replay bytes and keeps the flight times', () => {
      const out = verifyRun(prepared(), IAT + AFTER, null);
      if (!out.ok) throw new Error(out.reason);
      expect(out.run.entries.some((e) => e.h !== undefined)).toBe(true);
      const stored = decodeLog(flightLog(out.run.entries)) ?? [];
      expect(stored.every((e) => e.h === undefined)).toBe(true);
      expect(stored.map((e) => e.t)).toEqual(out.run.entries.map((e) => e.t));
      expect(replay(out.run.config, out.run.words, stored).score).toEqual(out.run.score);
    });
  });
});
