import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { rowsOf } from '@/db/client';
import { decodeLog } from '@/engine/log';
import type { LogEntry } from '@/engine/core';
import { paceOf } from '@/engine/analysis';
import { challengeDay } from '@/engine/day';
import { exportAccount } from '@/server/accounts';
import {
  deriveDailySeed,
  placeOf,
  progressOf,
  publicProfile,
  publicResult,
  publicSeed,
  rankedListId,
  revealToday,
  standings,
  submitRun,
  todayBoard,
  wouldHavePlaced,
  yourStanding,
  yourToday,
} from '@/server/ranking';
import { recomputeLadder } from '@/server/standing';
import { issueTicket } from '@/server/tickets';
import { wordsOf } from '@/server/verify';
import { PLAUSIBILITY_FIXTURE_JSON } from './helpers/fixtures';
import { type TestDb, createTestDb } from './helpers/db';
import { constantShape, humanShape } from './helpers/logs';
import { type BuildOptions, buildRun, perfectPrefix, rankedRequest } from './helpers/submissions';
import { EN_LIST, NOON, TODAY, count, expectRecorded, freeRun, insertRanked, profileIdOf, setSecrets, typist } from './helpers/world';

let t: TestDb;
let restore: () => void;

beforeAll(async () => {
  restore = setSecrets();
  t = await createTestDb();
});
afterAll(async () => {
  restore();
  await t.close();
});

async function reveal(clerkUserId: string, now = NOON) {
  const outcome = await revealToday(t.db, { clerkUserId, language: 'en', now });
  if (outcome.status !== 'revealed') throw new Error(`no reveal: ${JSON.stringify(outcome)}`);
  return outcome.issued;
}

async function daily(clerkUserId: string, options: BuildOptions = {}, now = NOON) {
  const issued = await reveal(clerkUserId, now);
  const built = buildRun({ issued, ...options });
  return { built, outcome: expectRecorded(await submitRun(t.db, { clerkUserId, body: built.body, now: now + 70_000 })) };
}

describe('a full ranked flow', () => {
  it('reveals, verifies, ranks, reports the best and shows on every surface', async () => {
    const user = await typist(t.db, 'ana');
    const id = await profileIdOf(t.db, user);
    const issued = await reveal(user);
    expect(issued.ticket.day).toBe(TODAY);
    expect(issued.ticket.pack).toBe('en-1k@1');
    expect(issued.ticket.seed).toBe(deriveDailySeed(TODAY, EN_LIST));

    const built = buildRun({ issued });
    const outcome = expectRecorded(await submitRun(t.db, { clerkUserId: user, body: built.body, now: NOON + 70_000 }));
    expect(outcome.retried).toBe(false);
    expect(outcome.result).toMatchObject({
      id: issued.ticket.nonce,
      kind: 'daily',
      status: 'passed',
      ranked: true,
      mode: 'time',
      amount: 60,
    });
    expect(outcome.result.wpmCx).toBeGreaterThan(9000);
    expect(outcome.personalBest).toEqual({ isNew: true, previousCx: null });
    expect(outcome.pace).toMatchObject({ runs: 1, listed: false, paceCx: outcome.result.wpmCx });
    expect(outcome.today).toEqual({ rank: 1, total: 1 });

    const board = await todayBoard(t.db, { day: TODAY, listId: EN_LIST });
    expect(board.total).toBe(1);
    expect(board.rows[0]).toEqual({ rank: 1, username: 'ana', wpmCx: outcome.result.wpmCx, accuracyBp: outcome.result.accuracyBp });

    const [row] = await rowsOf<Record<string, unknown>>(
      t.db,
      sql`SELECT scorer_version::int AS v, device, encode(seed, 'hex') AS seed, encode(body_hash, 'hex') AS hash, local_day::text AS local_day, octet_length(wpm_series)::int AS series FROM results WHERE id = ${issued.ticket.nonce}`,
    );
    expect(row).toMatchObject({ v: 1, device: 'keyboard', seed: issued.ticket.seed, local_day: '2026-11-06', series: 60 });
    expect(String(row?.hash)).toHaveLength(64);

    const [rollup] = await rowsOf<{ runs: number; ms: string }>(
      t.db,
      sql`SELECT runs::int, ms_typed::text AS ms FROM daily_rollups WHERE profile_id = ${id}`,
    );
    expect(rollup).toEqual({ runs: 1, ms: '60000' });
    expect(await count(t.db, 'rate_counters', sql`profile_id = ${id} AND bucket = 'submit'`)).toBe(1);

    const progress = await progressOf(t.db, { clerkUserId: user, now: new Date(NOON) });
    const keys = progress?.keys[0]?.counts ?? [];
    expect(keys.find((k) => k.key === ' ')?.hits).toBeGreaterThan(50);
    expect(keys.reduce((sum, k) => sum + k.hits, 0)).toBe(outcome.result.wpmCx > 0 ? built.entries.length : 0);
    expect(progress?.bests).toHaveLength(1);

    const profile = await publicProfile(t.db, 'ana');
    expect(profile).toMatchObject({ username: 'ana', rankedRuns: 1 });
    expect(profile?.lastDays[0]).toMatchObject({ day: TODAY, wpmCx: outcome.result.wpmCx });
    expect(JSON.stringify(profile)).not.toContain('Sao_Paulo');
    expect(await publicResult(t.db, issued.ticket.nonce)).toMatchObject({ username: 'ana', challengeDay: TODAY });
  });

  it('keeps flight times for a top-10 run, 30 days, without a single hold', async () => {
    const user = await typist(t.db, 'replayed');
    const { built, outcome } = await daily(user);
    expect(built.entries.some((e) => e.h !== undefined)).toBe(true);
    const [row] = await rowsOf<{ log: string; purge: string }>(
      t.db,
      sql`SELECT encode(log, 'hex') AS log, to_json(purge_after)#>>'{}' AS purge FROM replays WHERE result_id = ${outcome.result.id}`,
    );
    const stored = decodeLog(Buffer.from(row?.log ?? '', 'hex')) as LogEntry[];
    expect(stored.length).toBe(built.entries.length);
    expect(stored.every((e) => e.h === undefined)).toBe(true);
    expect(new Date(row?.purge ?? 0).getTime()).toBe(NOON + 70_000 + 30 * 86_400_000);
  });

  it('never gives the database a place for a hold time', async () => {
    const columns = await rowsOf<{ c: string }>(
      t.db,
      sql`SELECT column_name AS c FROM information_schema.columns WHERE table_schema = 'public'`,
    );
    const holdish = columns.map((r) => r.c).filter((c) => /hold|keyup|dwell/.test(c));
    expect(holdish.sort()).toEqual(['hold_reasons']);
  });

  it('keeps no replay for an ordinary free run', async () => {
    const user = await typist(t.db, 'plainrun');
    const { result } = await freeRun(t.db, user);
    expect(result.ranked).toBe(true);
    expect(await count(t.db, 'replays', sql`result_id = ${result.id}`)).toBe(0);
  });

  it('records but does not rank a run that fails a gate', async () => {
    const noConsent = 'user_noconsent';
    const built = buildRun({ iat: NOON });
    const outcome = expectRecorded(await submitRun(t.db, { clerkUserId: noConsent, body: built.body, now: NOON + 70_000 }));
    expect(outcome.result).toMatchObject({ status: 'passed', ranked: false });
    expect(outcome.pace).toBeNull();
    expect(outcome.personalBest?.isNew).toBe(true);

    const consented = await typist(t.db, 'touchtypist');
    const touch = await freeRun(t.db, consented, { meta: { device: 'touch' } });
    expect(touch.result.ranked).toBe(false);
    const other = await freeRun(t.db, consented, { request: { language: 'en', pack: 'en-200@1', mode: 'time', amount: 60 } });
    expect(other.result.ranked).toBe(false);
    const short = await freeRun(t.db, consented, { request: { language: 'en', pack: 'en-1k@1', mode: 'time', amount: 30 } });
    expect(short.result.ranked).toBe(false);
    expect(short.personalBest?.isNew).toBe(true);
  });

  it('holds a low accuracy run out of ranking at the gate', async () => {
    const user = await typist(t.db, 'mashy');
    const { result } = await freeRun(t.db, user, {
      mapEntries: (entries) =>
        entries.flatMap((e, i) => (i % 3 === 0 ? [{ k: 'c', ch: '#', t: e.t } as LogEntry, { k: 'b', t: e.t } as LogEntry, e] : [e])),
    });
    expect(result.accuracyBp).toBeLessThan(8500);
    expect(result.ranked).toBe(false);
  });

  it('reports a new best only when it is one, atomically, with the old value', async () => {
    const user = await typist(t.db, 'improver');
    const first = await freeRun(t.db, user, { shape: humanShape(70), seed: 3 });
    const faster = await freeRun(t.db, user, { shape: humanShape(90), seed: 4 }, NOON + 200_000);
    const slower = await freeRun(t.db, user, { shape: humanShape(60), seed: 5 }, NOON + 400_000);
    expect(first.personalBest).toEqual({ isNew: true, previousCx: null });
    expect(faster.personalBest).toEqual({ isNew: true, previousCx: first.result.wpmCx });
    expect(slower.personalBest).toEqual({ isNew: false, previousCx: faster.result.wpmCx });
  });
});

describe('single use', () => {
  it('rejects the ticket on a different body, and from anyone else', async () => {
    const owner = await typist(t.db, 'firstuse');
    const thief = await typist(t.db, 'thief');
    const built = buildRun({ iat: NOON, seed: 7 });
    expectRecorded(await submitRun(t.db, { clerkUserId: owner, body: built.body, now: NOON + 70_000 }));
    const differentBody = buildRun({ iat: NOON, seed: 8, issued: { token: built.token, ticket: built.ticket } });
    expect(await submitRun(t.db, { clerkUserId: owner, body: differentBody.body, now: NOON + 80_000 })).toEqual({
      status: 'rejected',
      reason: 'nonce-used',
    });
    expect(await submitRun(t.db, { clerkUserId: thief, body: built.body, now: NOON + 80_000 })).toEqual({
      status: 'rejected',
      reason: 'nonce-used',
    });
  });

  it('rejects a body the replay refuses', async () => {
    const user = await typist(t.db, 'emptylog');
    const built = buildRun({ iat: NOON, entries: [] });
    expect(await submitRun(t.db, { clerkUserId: user, body: built.body, now: NOON + 70_000 })).toEqual({
      status: 'rejected',
      reason: 'replay-failed',
    });
    expect(await count(t.db, 'results', sql`profile_id = ${await profileIdOf(t.db, user)}`)).toBe(0);
  });

  it('answers a retry from the stored row and counts nothing twice', async () => {
    const user = await typist(t.db, 'retrier');
    const id = await profileIdOf(t.db, user);
    const built = buildRun({ iat: NOON });
    const first = expectRecorded(await submitRun(t.db, { clerkUserId: user, body: built.body, now: NOON + 70_000 }));
    const second = expectRecorded(await submitRun(t.db, { clerkUserId: user, body: built.body, now: NOON + 9_000_000 }));
    expect(second.retried).toBe(true);
    expect(second.result).toEqual(first.result);
    expect(second.personalBest).toEqual(first.personalBest);
    expect(second.pace?.paceCx).toBe(first.pace?.paceCx);
    const [rollup] = await rowsOf<{ runs: number }>(t.db, sql`SELECT runs::int FROM daily_rollups WHERE profile_id = ${id}`);
    expect(rollup?.runs).toBe(1);
    const [counter] = await rowsOf<{ hits: number }>(t.db, sql`SELECT sum(hits)::int AS hits FROM rate_counters WHERE profile_id = ${id} AND bucket = 'submit'`);
    expect(counter?.hits).toBe(1);
  });

  it('survives two simultaneous submits of one run', async () => {
    const user = await typist(t.db, 'racer');
    const built = buildRun({ iat: NOON });
    const [a, b] = await Promise.all([
      submitRun(t.db, { clerkUserId: user, body: built.body, now: NOON + 70_000 }),
      submitRun(t.db, { clerkUserId: user, body: built.body, now: NOON + 70_000 }),
    ]);
    const recorded = [expectRecorded(a), expectRecorded(b)];
    expect(recorded[0]?.result.id).toBe(recorded[1]?.result.id);
    expect(await count(t.db, 'results', sql`id = ${built.ticket.nonce}`)).toBe(1);
  });

  it('caps submissions per hour and says so', async () => {
    const user = await typist(t.db, 'flooder');
    const id = await profileIdOf(t.db, user);
    const hour = new Date(NOON - (NOON % 3_600_000)).toISOString();
    await t.db.execute(sql`INSERT INTO rate_counters VALUES (${id}, 'submit', ${hour}::timestamptz, 240)`);
    const built = buildRun({ iat: NOON });
    expect(await submitRun(t.db, { clerkUserId: user, body: built.body, now: NOON + 70_000 })).toEqual({ status: 'rate-limited' });
    expect(await count(t.db, 'results', sql`id = ${built.ticket.nonce}`)).toBe(0);
  });
});

describe('the attempt', () => {
  it('is spent at reveal, whether or not the run ever finishes', async () => {
    const user = await typist(t.db, 'oneshot');
    const issued = await reveal(user);
    const second = await revealToday(t.db, { clerkUserId: user, language: 'en', now: NOON + 1000 });
    expect(second).toEqual({ status: 'spent', day: TODAY, finished: false });
    expect(JSON.stringify(second)).not.toContain(issued.ticket.seed);
    const board = await todayBoard(t.db, { day: TODAY, listId: EN_LIST });
    expect(board.rows.map((r) => r.username)).not.toContain('oneshot');
    const built = buildRun({ issued });
    expectRecorded(await submitRun(t.db, { clerkUserId: user, body: built.body, now: NOON + 70_000 }));
    expect(await revealToday(t.db, { clerkUserId: user, language: 'en', now: NOON + 80_000 })).toEqual({
      status: 'spent',
      day: TODAY,
      finished: true,
    });
  });

  it('is per language, and comes back the next day', async () => {
    const user = await typist(t.db, 'bilingual');
    await reveal(user);
    expect((await revealToday(t.db, { clerkUserId: user, language: 'pt', now: NOON })).status).toBe('revealed');
    expect((await revealToday(t.db, { clerkUserId: user, language: 'en', now: NOON + 86_400_000 })).status).toBe('revealed');
  });

  it('turns over at 06:00 UTC', async () => {
    const user = await typist(t.db, 'nightowl');
    const justBefore = Date.UTC(2026, 10, 10, 5, 59, 59);
    const justAfter = Date.UTC(2026, 10, 10, 6, 0, 0);
    const a = await revealToday(t.db, { clerkUserId: user, language: 'en', now: justBefore });
    const b = await revealToday(t.db, { clerkUserId: user, language: 'en', now: justAfter });
    expect(a).toMatchObject({ status: 'revealed', day: '2026-11-09' });
    expect(b).toMatchObject({ status: 'revealed', day: '2026-11-10' });
  });

  it('asks for what is missing rather than burning the attempt', async () => {
    expect(await revealToday(t.db, { clerkUserId: 'user_stranger', language: 'en', now: NOON })).toEqual({
      status: 'not-eligible',
      missing: ['username', 'consent'],
    });
  });

  it('gives everyone the same text, and keeps it when the secret rotates', async () => {
    const a = await reveal(await typist(t.db, 'sharer1'));
    const saved = process.env.DAILY_SECRET;
    process.env.DAILY_SECRET = 'a-rotated-secret-a-rotated-secret-a-rotated';
    const b = await reveal(await typist(t.db, 'sharer2'));
    process.env.DAILY_SECRET = saved;
    expect(b.ticket.seed).toBe(a.ticket.seed);
    expect(a.ticket.nonce).not.toBe(b.ticket.nonce);
  });

  it('refuses another typist’s daily ticket', async () => {
    const owner = await typist(t.db, 'ticketowner');
    const other = await typist(t.db, 'ticketborrower');
    const issued = await reveal(owner);
    const built = buildRun({ issued });
    expect(await submitRun(t.db, { clerkUserId: other, body: built.body, now: NOON + 70_000 })).toEqual({
      status: 'rejected',
      reason: 'attempt-mismatch',
    });
    await reveal(other);
    expect(await submitRun(t.db, { clerkUserId: other, body: built.body, now: NOON + 70_000 })).toEqual({
      status: 'rejected',
      reason: 'attempt-mismatch',
    });
  });

  it('publishes yesterday’s seed and never today’s', async () => {
    const yesterday = challengeDay(NOON - 86_400_000);
    expect(await publicSeed(t.db, { day: TODAY, language: 'en', now: NOON })).toBeNull();
    expect(await publicSeed(t.db, { day: '2030-01-01', language: 'en', now: NOON })).toBeNull();
    expect(await publicSeed(t.db, { day: yesterday, language: 'en', now: NOON })).toEqual({
      seed: deriveDailySeed(yesterday, EN_LIST),
      pack: 'en-1k@1',
    });
    const stored = await publicSeed(t.db, { day: TODAY, language: 'en', now: NOON + 86_400_000 });
    expect(stored?.seed).toBe(deriveDailySeed(TODAY, EN_LIST));
  });
});

describe('ties', () => {
  const day = '2026-12-01';
  const noon = Date.UTC(2026, 11, 1, 12, 0, 0);
  let order: { rank: number; username: string; wpmCx: number; accuracyBp: number }[];
  let perfect: number;

  /** All type the same 500 characters at the same speed, so only accuracy and arrival differ. */
  const run = async (name: string, typos: number, shift = 0) => {
    const user = await typist(t.db, name);
    const issued = await reveal(user, noon);
    const built = buildRun({
      issued,
      startAfter: 1000 + shift,
      endAfter: 61_000 + shift,
      mapEntries: (_entries, words) => {
        const base = perfectPrefix(words, 500, 100);
        const out: LogEntry[] = [];
        base.forEach((entry, i) => {
          if (i >= 50 && i < 50 + typos * 3 && i % 3 === 2) out.push({ k: 'c', ch: '#', t: entry.t, h: 70 }, { k: 'b', t: entry.t, h: 70 });
          out.push(entry);
        });
        return out;
      },
    });
    return expectRecorded(await submitRun(t.db, { clerkUserId: user, body: built.body, now: noon + 70_000 + shift }));
  };

  beforeAll(async () => {
    const results = [
      await run('tie_typo', 3),
      await run('tie_perfect', 0),
      await run('tie_oneoff', 1),
      await run('tie_late', 0, 5000),
      await run('tie_same', 1, 3000),
    ];
    perfect = results[1]?.result.accuracyBp ?? 0;
    const wpm = new Set(results.map((r) => r.result.wpmCx));
    expect(wpm.size).toBe(1);
    order = (await todayBoard(t.db, { day, listId: EN_LIST })).rows;
  });

  it('sorts a perfect 100% above everything at equal WPM', () => {
    expect(perfect).toBe(10000);
    expect(order[0]).toMatchObject({ username: 'tie_perfect', accuracyBp: 10000, rank: 1 });
  });

  it('shares a rank on an exact tie and skips the next, ordered by who finished first', () => {
    expect(order.map((r) => [r.username, r.rank])).toEqual([
      ['tie_perfect', 1],
      ['tie_late', 1],
      ['tie_oneoff', 3],
      ['tie_same', 3],
      ['tie_typo', 5],
    ]);
  });

  it('decodes accuracy untouched, where an encoded score would read 100% as 0', () => {
    expect(order.find((r) => r.username === 'tie_late')?.accuracyBp).toBe(10000);
    expect(order[2]?.accuracyBp).toBeLessThan(10000);
    expect(order[2]?.accuracyBp).toBeGreaterThan(order[4]?.accuracyBp ?? 0);
  });

  it('gives your place and neighbours in board order', async () => {
    const mine = await yourToday(t.db, { clerkUserId: 'user_tie_oneoff', day, listId: EN_LIST });
    expect(mine).toMatchObject({ rank: 3, total: 5, onBoard: true });
    expect(mine?.above.map((r) => r.username)).toEqual(['tie_perfect', 'tie_late']);
    expect(mine?.below.map((r) => r.username)).toEqual(['tie_same', 'tie_typo']);
    expect(mine?.below.map((r) => r.rank)).toEqual([3, 5]);
  });

  it('places a guest against the finished day from five players', async () => {
    const later = noon + 86_400_000;
    expect(await wouldHavePlaced(t.db, { day, language: 'en', wpmCx: 999_999, accuracyBp: 10000, now: later })).toEqual({
      rank: 1,
      total: 5,
    });
    const tied = await wouldHavePlaced(t.db, { day, language: 'en', wpmCx: order[0]?.wpmCx ?? 0, accuracyBp: 10000, now: later });
    expect(tied).toEqual({ rank: 1, total: 5 });
    expect(await wouldHavePlaced(t.db, { day, language: 'en', wpmCx: 1, accuracyBp: 1, now: later })).toEqual({ rank: 6, total: 5 });
    expect(await wouldHavePlaced(t.db, { day, language: 'en', wpmCx: 1, accuracyBp: 1, now: noon })).toBeNull();
    expect(await wouldHavePlaced(t.db, { day: '2026-11-20', language: 'en', wpmCx: 1, accuracyBp: 1, now: later })).toBeNull();
  });

  it('keeps the rank right on a page that starts midway through a tie', async () => {
    const pageDay = '2026-12-05';
    const ids = await rowsOf<{ id: number }>(
      t.db,
      sql`INSERT INTO profiles (clerk_user_id, username, ranking_consent_at, listed_at) SELECT 'tiepage' || g, 'tiepage' || g, now(), now() FROM generate_series(1, 60) g RETURNING id::int`,
    );
    for (const [i, { id }] of ids.entries()) {
      const wpm = i < 10 ? 9000 : 8000;
      await t.db.execute(sql`
        INSERT INTO daily_entries (challenge_day, list_id, profile_id, ticket_nonce, wpm_cx, accuracy_bp, finished_at, visible)
        VALUES (${pageDay}::date, ${EN_LIST}, ${id}, gen_random_uuid(), ${wpm}, 9500, ${new Date(noon + i * 1000).toISOString()}::timestamptz, true)
      `);
    }
    const second = await todayBoard(t.db, { day: pageDay, listId: EN_LIST, page: 1 });
    expect(second.total).toBe(60);
    expect(second.rows).toHaveLength(10);
    expect(new Set(second.rows.map((r) => r.rank))).toEqual(new Set([11]));
  });
});

describe('pace', () => {
  async function parity(values: number[]) {
    const user = `user_pace${values.length}`;
    await t.db.execute(
      sql`INSERT INTO profiles (clerk_user_id, username, ranking_consent_at, listed_at) VALUES (${user}, ${`pace${values.length}`}, now(), now())`,
    );
    const id = await profileIdOf(t.db, user);
    await insertRanked(t.db, id, values, (i) => new Date(NOON - i * 60_000));
    const [raw] = await rowsOf<{ p: number }>(
      t.db,
      sql`SELECT percentile_cont(0.8) WITHIN GROUP (ORDER BY wpm_cx)::float8 AS p FROM results WHERE profile_id = ${id} AND ranked`,
    );
    const stored = await recomputeLadder(t.db, id, EN_LIST, new Date(NOON));
    return { raw: Number(raw?.p), stored };
  }

  it.each([1, 2, 3, 10, 25])('matches paceOf to the bit at n=%i', async (n) => {
    const values = Array.from({ length: n }, (_, i) => 6000 + ((i * 7919 + 13) % 4003));
    const { raw, stored } = await parity(values);
    expect(raw).toBe(paceOf(values));
    expect(stored?.paceCx).toBe(Math.round(paceOf(values) ?? 0));
    expect(stored?.runs).toBe(n);
    expect(stored?.eligible).toBe(n >= 10);
  });

  it('uses only the last 25 runs in 90 days', async () => {
    await t.db.execute(
      sql`INSERT INTO profiles (clerk_user_id, username, ranking_consent_at, listed_at) VALUES ('user_window', 'windowed', now(), now())`,
    );
    const id = await profileIdOf(t.db, 'user_window');
    const recent = Array.from({ length: 25 }, (_, i) => 5000 + i * 10);
    await insertRanked(t.db, id, recent, (i) => new Date(NOON - i * 60_000));
    await insertRanked(t.db, id, [20000, 20000], (i) => new Date(NOON - 86_400_000 * 2 - i));
    const stored = await recomputeLadder(t.db, id, EN_LIST, new Date(NOON));
    expect(stored?.paceCx).toBe(Math.round(paceOf(recent) ?? 0));
    const later = await recomputeLadder(t.db, id, EN_LIST, new Date(NOON + 91 * 86_400_000));
    expect(later).toBeNull();
    expect(await count(t.db, 'ladder', sql`profile_id = ${id}`)).toBe(0);
  });

  it('keeps Standings hidden until 20 eligible typists, then ranks with ties shared', async () => {
    const list = rankedListId('pt');
    expect(await standings(t.db, { listId: list })).toEqual({ shown: false, eligible: 0, rows: [] });
    for (let i = 0; i < 20; i++) {
      await t.db.execute(
        sql`INSERT INTO profiles (clerk_user_id, username, ranking_consent_at, listed_at) VALUES (${`user_st${i}`}, ${`standing${i}`}, now(), now())`,
      );
      const id = await profileIdOf(t.db, `user_st${i}`);
      await insertRanked(t.db, id, Array(10).fill(i === 1 ? 7000 : 7000 + i * 100) as number[], (k) => new Date(NOON - k * 60_000), list);
      await recomputeLadder(t.db, id, list, new Date(NOON));
      if (i === 18) expect((await standings(t.db, { listId: list })).shown).toBe(false);
    }
    const board = await standings(t.db, { listId: list });
    expect(board).toMatchObject({ shown: true, eligible: 20 });
    expect(board.rows[0]).toMatchObject({ rank: 1, username: 'standing19', paceCx: 8900 });
    expect(board.rows.slice(-2).map((r) => [r.username, r.rank])).toEqual([
      ['standing0', 19],
      ['standing1', 19],
    ]);
    const mine = await yourStanding(t.db, { clerkUserId: 'user_st10', listId: list });
    expect(mine).toMatchObject({ rank: 10, total: 20, eligible: true });
    expect(mine?.above.map((r) => r.username)).toEqual(['standing12', 'standing11']);
    expect(mine?.below.map((r) => r.username)).toEqual(['standing9', 'standing8']);
  });

  it('does not list an unlisted typist, but still tells them where they would be', async () => {
    const user = await typist(t.db, 'privately', false);
    const { outcome } = await daily(user);
    expect(outcome.result.ranked).toBe(true);
    const board = await todayBoard(t.db, { day: TODAY, listId: EN_LIST });
    expect(board.rows.map((r) => r.username)).not.toContain('privately');
    expect(await yourToday(t.db, { clerkUserId: user, day: TODAY, listId: EN_LIST })).toMatchObject({ onBoard: false });
    expect(await publicProfile(t.db, 'privately')).toBeNull();
    expect(await publicResult(t.db, outcome.result.id)).toBeNull();
  });
});

describe('holds', () => {
  const saved = process.env.PLAUSIBILITY;
  beforeEach(() => {
    process.env.PLAUSIBILITY = PLAUSIBILITY_FIXTURE_JSON;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.PLAUSIBILITY;
    else process.env.PLAUSIBILITY = saved;
  });
  const robot = { shape: constantShape(170) };
  const person = { shape: humanShape(160), seed: 11 };

  it('quarantines rather than rejects, privately, and says nothing of why', async () => {
    const user = await typist(t.db, 'heldone');
    const outcome = await freeRun(t.db, user, robot);
    expect(outcome.result).toMatchObject({ status: 'held', ranked: false });
    expect(outcome.personalBest).toBeNull();
    expect(outcome.pace).toBeNull();
    expect(JSON.stringify(outcome)).not.toMatch(/iki|reason|hold/i);
    const id = await profileIdOf(t.db, user);
    const [row] = await rowsOf<{ reasons: string[]; rankable: boolean }>(
      t.db,
      sql`SELECT hold_reasons AS reasons, rankable FROM results WHERE id = ${outcome.result.id}`,
    );
    expect(row?.reasons).toContain('iki-cv');
    expect(row?.rankable).toBe(true);
    expect(await count(t.db, 'personal_bests', sql`profile_id = ${id}`)).toBe(0);
    const [replay] = await rowsOf<{ log: string }>(
      t.db,
      sql`SELECT encode(log, 'hex') AS log FROM replays WHERE result_id = ${outcome.result.id}`,
    );
    expect((decodeLog(Buffer.from(replay?.log ?? '', 'hex')) ?? []).every((e) => e.h === undefined)).toBe(true);
    expect((decodeLog(Buffer.from(replay?.log ?? '', 'hex')) ?? []).length).toBeGreaterThan(100);
  });

  it('keeps no flight times for a held run from someone who has not consented', async () => {
    const user = 'user_unconsenting';
    const built = buildRun({ iat: NOON, ...robot });
    const outcome = expectRecorded(await submitRun(t.db, { clerkUserId: user, body: built.body, now: NOON + 70_000 }));
    expect(outcome.result.status).toBe('held');
    expect(await count(t.db, 'replays', sql`result_id = ${outcome.result.id}`)).toBe(0);
  });

  it('keeps a held Today run off the board, with the attempt spent', async () => {
    const user = await typist(t.db, 'heldtoday');
    const { outcome } = await daily(user, robot, NOON);
    expect(outcome.result.status).toBe('held');
    expect((await todayBoard(t.db, { day: TODAY, listId: EN_LIST })).rows.map((r) => r.username)).not.toContain('heldtoday');
    expect(await yourToday(t.db, { clerkUserId: user, day: TODAY, listId: EN_LIST })).toMatchObject({ onBoard: false });
  });

  it('downgrades a late stamp on a recorded run instead of rejecting', async () => {
    const user = await typist(t.db, 'slowlink');
    const outcome = await freeRun(t.db, user, { ...person, endAfter: 90_000 }, NOON);
    expect(outcome.result).toMatchObject({ status: 'unverified', ranked: false });
    expect(outcome.personalBest).toBeNull();
  });

  it('releases on a retype at 85% or more, and ranks the held run', async () => {
    const user = await typist(t.db, 'retyper');
    const held = await freeRun(t.db, user, robot, NOON);
    const heldCx = held.result.wpmCx;
    const fresh = await freeRun(t.db, user, { ...person, meta: { confirms: held.result.id } }, NOON + 200_000);
    expect(fresh.result.status).toBe('passed');
    expect(fresh.result.wpmCx * 100).toBeGreaterThanOrEqual(heldCx * 85);
    expect(fresh.released).toBe(held.result.id);
    const [row] = await rowsOf<{ status: string; ranked: boolean; reviewed: string | null; by: string }>(
      t.db,
      sql`SELECT status, ranked, reviewed_at::text AS reviewed, confirmed_by AS by FROM results WHERE id = ${held.result.id}`,
    );
    expect(row).toEqual({ status: 'passed', ranked: true, reviewed: null, by: fresh.result.id });
    const id = await profileIdOf(t.db, user);
    const [ladder] = await rowsOf<{ runs: number }>(t.db, sql`SELECT runs_in_window::int AS runs FROM ladder WHERE profile_id = ${id}`);
    expect(ladder?.runs).toBe(2);
    const [best] = await rowsOf<{ wpm: number }>(t.db, sql`SELECT wpm_cx::int AS wpm FROM personal_bests WHERE profile_id = ${id}`);
    expect(best?.wpm).toBe(Math.max(heldCx, fresh.result.wpmCx));
  });

  it('does not release under 85%, on a held fresh run, or for someone else’s hold', async () => {
    const user = await typist(t.db, 'failedretype');
    const held = await freeRun(t.db, user, robot, NOON);
    const slow = await freeRun(t.db, user, { shape: humanShape(100), seed: 2, meta: { confirms: held.result.id } }, NOON + 200_000);
    expect(slow.result.wpmCx * 100).toBeLessThan(held.result.wpmCx * 85);
    expect(slow.released).toBeNull();
    const robotAgain = await freeRun(t.db, user, { ...robot, meta: { confirms: held.result.id } }, NOON + 400_000);
    expect(robotAgain.released).toBeNull();
    const other = await typist(t.db, 'notmyhold');
    const foreign = await freeRun(t.db, other, { ...person, meta: { confirms: held.result.id } }, NOON + 600_000);
    expect(foreign.released).toBeNull();
    const [row] = await rowsOf<{ status: string }>(t.db, sql`SELECT status FROM results WHERE id = ${held.result.id}`);
    expect(row?.status).toBe('held');
  });

  it('puts a released Today run back on the board', async () => {
    const user = await typist(t.db, 'todayrelease');
    const { outcome } = await daily(user, robot, NOON);
    await freeRun(t.db, user, { ...person, meta: { confirms: outcome.result.id } }, NOON + 200_000);
    expect((await todayBoard(t.db, { day: TODAY, listId: EN_LIST })).rows.map((r) => r.username)).toContain('todayrelease');
  });

  it('holds an above-Pace jump only once there is history', async () => {
    const user = await typist(t.db, 'jumpy');
    const id = await profileIdOf(t.db, user);
    await insertRanked(t.db, id, Array(10).fill(6000) as number[], (i) => new Date(NOON - 3_600_000 - i * 60_000));
    await recomputeLadder(t.db, id, EN_LIST, new Date(NOON - 3_600_000));
    const jump = await freeRun(t.db, user, person, NOON);
    expect(jump.result.status).toBe('held');
    const [row] = await rowsOf<{ reasons: string[] }>(t.db, sql`SELECT hold_reasons AS reasons FROM results WHERE id = ${jump.result.id}`);
    expect(row?.reasons).toContain('above-pace');
  });

  it('applies no board trigger on a board under 1,000 entries', async () => {
    const user = await typist(t.db, 'smallboard');
    const outcome = await freeRun(t.db, user, person, NOON);
    expect(outcome.result.status).toBe('passed');
    expect(outcome.result.ranked).toBe(true);
  });
});

describe('exports of a ranked typist', () => {
  it('returns every kind of row as plain JSON, with no flight time disguised and no internal id', async () => {
    const user = await typist(t.db, 'exporter');
    const { outcome } = await daily(user);
    const data = await exportAccount(t.db, user);
    const text = JSON.stringify(data);
    expect(JSON.parse(text)).toMatchObject({ profile: { username: 'exporter' } });
    expect(data?.results).toHaveLength(1);
    expect(text).toContain(outcome.result.id);
    expect(data?.dailyEntries).toHaveLength(1);
    expect(data?.replays).toHaveLength(1);
    expect(text).not.toContain('user_exporter');
    expect(await exportAccount(t.db, 'user_nobody')).toBeNull();
  });
});

describe('places', () => {
  it('counts only rows strictly above', async () => {
    const day = '2026-12-20';
    await t.db.execute(
      sql`INSERT INTO profiles (clerk_user_id, username, ranking_consent_at, listed_at) VALUES ('user_p1', 'placeone', now(), now())`,
    );
    const id = await profileIdOf(t.db, 'user_p1');
    await t.db.execute(sql`
      INSERT INTO daily_entries (challenge_day, list_id, profile_id, ticket_nonce, wpm_cx, accuracy_bp, finished_at, visible)
      VALUES (${day}::date, ${EN_LIST}, ${id}, gen_random_uuid(), 9000, 9000, now(), true)
    `);
    expect(await placeOf(t.db, day, EN_LIST, 9000, 9000)).toEqual({ rank: 1, total: 1 });
    expect(await placeOf(t.db, day, EN_LIST, 9000, 8999)).toEqual({ rank: 2, total: 1 });
    expect(await placeOf(t.db, day, EN_LIST, 9001, 1)).toEqual({ rank: 1, total: 1 });
  });
});

describe('ranks after a tie that crosses a page boundary', () => {
  // 49 distinct scores, then a tie on places 50 and 51, then distinct again: page 1 opens on the second tied row.
  const score = (i: number): number => (i <= 48 ? 10_000 - i : i <= 50 ? 5000 : 4000 - i);

  it('stays right on the rest of a Today page', async () => {
    const day = '2026-10-01';
    const ids = await rowsOf<{ id: number }>(
      t.db,
      sql`INSERT INTO profiles (clerk_user_id, username, ranking_consent_at, listed_at) SELECT 'crosspage' || g, 'crosspage' || g, now(), now() FROM generate_series(1, 60) g RETURNING id::int`,
    );
    for (const [i, { id }] of ids.entries()) {
      await t.db.execute(sql`
        INSERT INTO daily_entries (challenge_day, list_id, profile_id, ticket_nonce, wpm_cx, accuracy_bp, finished_at, visible)
        VALUES (${day}::date, ${EN_LIST}, ${id}, gen_random_uuid(), ${score(i)}, 9500, ${new Date(NOON + i * 1000).toISOString()}::timestamptz, true)
      `);
    }
    const ranks = (await todayBoard(t.db, { day, listId: EN_LIST, page: 1 })).rows.map((r) => r.rank);
    expect(ranks).toEqual([50, 52, 53, 54, 55, 56, 57, 58, 59, 60]);
  });

  it('stays right on the rest of a Standings page', async () => {
    const listId = 6;
    const ids = await rowsOf<{ id: number }>(
      t.db,
      sql`INSERT INTO profiles (clerk_user_id, username, ranking_consent_at, listed_at) SELECT 'crossladder' || g, 'crossladder' || g, now(), now() FROM generate_series(1, 60) g RETURNING id::int`,
    );
    for (const [i, { id }] of ids.entries()) {
      await t.db.execute(sql`
        INSERT INTO ladder (profile_id, list_id, pace_cx, best_cx, runs_in_window, last_ranked_at, oldest_in_window_at, eligible)
        VALUES (${id}, ${listId}, ${score(i)}, ${score(i)}, 10, now(), now(), true)
      `);
    }
    const ranks = (await standings(t.db, { listId, page: 1 })).rows.map((r) => r.rank);
    expect(ranks).toEqual([50, 52, 53, 54, 55, 56, 57, 58, 59, 60]);
  });
});

describe('a downgrade that also trips a hold', () => {
  const saved = process.env.PLAUSIBILITY;
  beforeEach(() => {
    process.env.PLAUSIBILITY = PLAUSIBILITY_FIXTURE_JSON;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.PLAUSIBILITY;
    else process.env.PLAUSIBILITY = saved;
  });
  const reasonsAndRankable = async (id: string) => {
    const [row] = await rowsOf<{ reasons: string[]; rankable: boolean; ranked: boolean }>(
      t.db,
      sql`SELECT hold_reasons AS reasons, rankable, ranked FROM results WHERE id = ${id}`,
    );
    return row;
  };

  it('stays out of ranking after a retype, on a Today run rehearsed between its stamps', async () => {
    const user = await typist(t.db, 'launderer');
    const issued = await reveal(user, NOON);
    const built = buildRun({ issued, shape: constantShape(170), startAfter: 1000, endAfter: 900_000 });
    const held = expectRecorded(await submitRun(t.db, { clerkUserId: user, body: built.body, now: NOON + 900_100 }));
    expect(held.result.status).toBe('held');
    expect(await reasonsAndRankable(held.result.id)).toMatchObject({ rankable: false });
    expect((await reasonsAndRankable(held.result.id))?.reasons).toContain('stamp-long');

    const fresh = await freeRun(t.db, user, { shape: humanShape(160), seed: 11, meta: { confirms: held.result.id } }, NOON + 1_000_000);
    expect(fresh.result.status).toBe('passed');
    expect(await reasonsAndRankable(held.result.id)).toMatchObject({ ranked: false });
    expect((await todayBoard(t.db, { day: TODAY, listId: EN_LIST })).rows.map((r) => r.username)).not.toContain('launderer');
  });

  it('stays unrankable when the hold comes from the typist’s history, on an expired ticket', async () => {
    const user = await typist(t.db, 'staleticket');
    const id = await profileIdOf(t.db, user);
    await insertRanked(t.db, id, Array.from({ length: 12 }, () => 13_000), (i) => new Date(NOON - (i + 1) * 3_600_000));
    await recomputeLadder(t.db, id, EN_LIST, new Date(NOON));
    const built = buildRun({ iat: NOON, shape: humanShape(190), seed: 5, startAfter: null, endAfter: 3_000_000 });
    const outcome = expectRecorded(await submitRun(t.db, { clerkUserId: user, body: built.body, now: NOON + 3_000_000 }));
    expect(outcome.result.status).toBe('held');
    expect(await reasonsAndRankable(outcome.result.id)).toMatchObject({ rankable: false });
  });
});

describe('public pages', () => {
  it('say nothing about the time of day someone types, which would give away their zone and their sleep', async () => {
    const user = await typist(t.db, 'nightowl');
    const run = await freeRun(t.db, user, { shape: humanShape(90), seed: 3 }, NOON + 5 * 3_600_000 + 1234);
    const page = JSON.stringify([await publicProfile(t.db, 'nightowl'), await publicResult(t.db, run.result.id)]);
    expect(page).not.toMatch(/\d{2}:\d{2}/);
    expect(await publicResult(t.db, run.result.id)).toMatchObject({ finishedOn: TODAY });
    expect((await publicProfile(t.db, 'nightowl'))?.bests[0]?.achievedOn).toBe(TODAY);
  });
});

describe('your standing while Standings is hidden', () => {
  it('names nobody until 20 eligible typists exist, then names your neighbours', async () => {
    const listId = 3;
    const ids = await rowsOf<{ id: number }>(
      t.db,
      sql`INSERT INTO profiles (clerk_user_id, username, ranking_consent_at, listed_at) SELECT 'hiddenrank' || g, 'hiddenrank' || g, now(), now() FROM generate_series(1, 20) g RETURNING id::int`,
    );
    const seat = (id: number, pace: number) => sql`
      INSERT INTO ladder (profile_id, list_id, pace_cx, best_cx, runs_in_window, last_ranked_at, oldest_in_window_at, eligible)
      VALUES (${id}, ${listId}, ${pace}, ${pace}, 10, now(), now(), true)
    `;
    for (const [i, { id }] of ids.slice(0, 19).entries()) await t.db.execute(seat(id, 6000 - i));
    expect(await yourStanding(t.db, { clerkUserId: 'hiddenrank5', listId })).toMatchObject({ shown: false, above: [], below: [] });
    await t.db.execute(seat(ids[19]?.id ?? 0, 1000));
    const open = await yourStanding(t.db, { clerkUserId: 'hiddenrank5', listId });
    expect(open).toMatchObject({ shown: true, rank: 5 });
    expect(open?.above.map((r) => r.username)).toEqual(['hiddenrank3', 'hiddenrank4']);
  });
});

describe('a forged log', () => {
  const saved = process.env.PLAUSIBILITY;
  beforeEach(() => {
    process.env.PLAUSIBILITY = PLAUSIBILITY_FIXTURE_JSON;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.PLAUSIBILITY;
    else process.env.PLAUSIBILITY = saved;
  });

  it('is held rather than a 500 when ignored keys before the run push its first key past what a delta can hold', async () => {
    const user = await typist(t.db, 'farapart');
    const issued = issueTicket(rankedRequest(), NOON);
    const typedKeys = perfectPrefix(wordsOf(issued.ticket) ?? [], 700, 80);
    const shift = 2 ** 32;
    const entries: LogEntry[] = [{ k: 'b', t: 2 ** 31 }, { k: 'b', t: shift }, ...typedKeys.map((entry) => ({ ...entry, t: entry.t + shift }))];
    const built = buildRun({ issued, entries, startAfter: 1000, endAfter: 61_000 });
    const outcome = expectRecorded(await submitRun(t.db, { clerkUserId: user, body: built.body, now: NOON + 70_000 }));
    expect(outcome.result.status).toBe('held');
    const [replay] = await rowsOf<{ log: string }>(t.db, sql`SELECT encode(log, 'hex') AS log FROM replays WHERE result_id = ${outcome.result.id}`);
    expect(decodeLog(Buffer.from(replay?.log ?? '', 'hex'))?.[0]?.t).toBe(0);
  });
});

describe('a browser’s time zone', () => {
  it('is no reason to refuse a run when it is an offset, which the format allows and browsers can report', async () => {
    const user = await typist(t.db, 'offsetzone');
    const outcome = await freeRun(t.db, user, { shape: humanShape(80), seed: 9, meta: { timeZone: '+03:00' } }, NOON);
    expect(outcome.result.status).toBe('passed');
  });

  it('falls back to UTC on nonsense rather than losing the run, which is no integrity failure', async () => {
    const user = await typist(t.db, 'nonsensezone');
    const outcome = await freeRun(t.db, user, { shape: humanShape(80), seed: 10, meta: { timeZone: '<script>' } }, NOON);
    expect(outcome.result.status).toBe('passed');
  });
});
