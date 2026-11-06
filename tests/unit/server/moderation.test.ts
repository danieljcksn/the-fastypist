import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { rowsOf } from '@/db/client';
import { findProfile } from '@/server/accounts';
import {
  REPORTS_PER_DAY,
  banProfile,
  dismissReport,
  fileReport,
  forceRename,
  heldRuns,
  openReports,
  releaseHold,
  runDailyJob,
  voidResult,
} from '@/server/moderation';
import { progressOf, publicProfile, publicResult, revealToday, standings, submitRun, todayBoard, yourToday } from '@/server/ranking';
import { recomputeLadder } from '@/server/standing';
import { PLAUSIBILITY_FIXTURE_JSON } from './helpers/fixtures';
import { type TestDb, createTestDb } from './helpers/db';
import { constantShape, humanShape } from './helpers/logs';
import { buildRun } from './helpers/submissions';
import { EN_LIST, NOON, TODAY, count, expectRecorded, freeRun, insertRanked, profileIdOf, setSecrets, typist } from './helpers/world';

let t: TestDb;
let restore: () => void;
const now = new Date(NOON);
const admin = { adminClerkId: 'user_admin', now };

beforeAll(async () => {
  restore = setSecrets();
  t = await createTestDb();
});
afterAll(async () => {
  restore();
  await t.close();
});

async function audits(subjectId: number): Promise<string[]> {
  const rows = await rowsOf<{ action: string }>(t.db, sql`SELECT action FROM admin_audit WHERE subject_id = ${subjectId} ORDER BY id`);
  return rows.map((r) => r.action);
}

describe('reports', () => {
  it('needs a target that exists', async () => {
    const user = await typist(t.db, 'reporter0');
    expect(await fileReport(t.db, { clerkUserId: user, target: 'username', username: 'nobody-here', now })).toEqual({
      ok: false,
      reason: 'not-found',
    });
    expect(await fileReport(t.db, { clerkUserId: user, target: 'username', now })).toEqual({ ok: false, reason: 'not-found' });
    expect(await fileReport(t.db, { clerkUserId: user, target: 'result', username: 'reporter0', now })).toEqual({
      ok: false,
      reason: 'not-found',
    });
  });

  it('cannot be turned on yourself, and an appeal only on your own run', async () => {
    const user = await typist(t.db, 'reporter1');
    const other = await typist(t.db, 'reported1');
    expect(await fileReport(t.db, { clerkUserId: user, target: 'username', username: 'reporter1', now })).toEqual({
      ok: false,
      reason: 'self',
    });
    const mine = await freeRun(t.db, user);
    const theirs = await freeRun(t.db, other);
    expect((await fileReport(t.db, { clerkUserId: user, target: 'appeal', resultId: mine.result.id, now })).ok).toBe(true);
    expect(await fileReport(t.db, { clerkUserId: user, target: 'appeal', resultId: theirs.result.id, now })).toEqual({
      ok: false,
      reason: 'self',
    });
    expect(await fileReport(t.db, { clerkUserId: user, target: 'result', resultId: mine.result.id, now })).toEqual({
      ok: false,
      reason: 'self',
    });
  });

  it('allows one open report per reporter and target, and another once it closes', async () => {
    const user = await typist(t.db, 'reporter2');
    await typist(t.db, 'reported2');
    const first = await fileReport(t.db, { clerkUserId: user, target: 'username', username: 'reported2', now });
    expect(await fileReport(t.db, { clerkUserId: user, target: 'username', username: 'reported2', now })).toEqual({
      ok: false,
      reason: 'duplicate',
    });
    if (!first.ok) throw new Error(first.reason);
    await dismissReport(t.db, { ...admin, reportId: first.id });
    expect((await fileReport(t.db, { clerkUserId: user, target: 'username', username: 'reported2', now })).ok).toBe(true);
  });

  it('limits a reporter to 5 a day and notes to 280 characters', async () => {
    const user = await typist(t.db, 'reporter3');
    for (let i = 0; i <= REPORTS_PER_DAY; i++) await typist(t.db, `quota${i}`);
    expect(await fileReport(t.db, { clerkUserId: user, target: 'username', username: 'quota0', note: 'x'.repeat(281), now })).toEqual({
      ok: false,
      reason: 'note-too-long',
    });
    for (let i = 0; i < REPORTS_PER_DAY; i++)
      expect(
        (await fileReport(t.db, { clerkUserId: user, target: 'username', username: `quota${i}`, note: 'x'.repeat(280), now })).ok,
      ).toBe(true);
    expect(await fileReport(t.db, { clerkUserId: user, target: 'username', username: `quota${REPORTS_PER_DAY}`, now })).toEqual({
      ok: false,
      reason: 'rate-limited',
    });
    const tomorrow = new Date(NOON + 86_400_000);
    expect((await fileReport(t.db, { clerkUserId: user, target: 'username', username: `quota${REPORTS_PER_DAY}`, now: tomorrow })).ok).toBe(
      true,
    );
  });

  it('acts on nothing by itself, and shows in the queue', async () => {
    const user = await typist(t.db, 'reporter4');
    await typist(t.db, 'reported4');
    await fileReport(t.db, { clerkUserId: user, target: 'username', username: 'reported4', note: 'look', now });
    expect(await findProfile(t.db, 'user_reported4')).toMatchObject({ username: 'reported4', bannedAt: null });
    const queue = await openReports(t.db, 500);
    expect(queue.find((r) => r.username === 'reported4')).toMatchObject({ target: 'username', note: 'look' });
  });

  it('writes an audit row when dismissed, and only once', async () => {
    const user = await typist(t.db, 'reporter5');
    const subject = await typist(t.db, 'reported5');
    const report = await fileReport(t.db, { clerkUserId: user, target: 'username', username: 'reported5', now });
    if (!report.ok) throw new Error(report.reason);
    expect(await dismissReport(t.db, { ...admin, reportId: report.id, note: 'fine' })).toBe(true);
    expect(await dismissReport(t.db, { ...admin, reportId: report.id })).toBe(false);
    expect(await audits(await profileIdOf(t.db, subject))).toEqual(['dismiss']);
  });
});

describe('voiding', () => {
  it('recomputes personal best, Pace, rollup, visibility and the finished day’s ranks', async () => {
    const cheat = await typist(t.db, 'voidme');
    const rival = await typist(t.db, 'rival');
    const id = await profileIdOf(t.db, cheat);

    const revealCheat = await revealToday(t.db, { clerkUserId: cheat, language: 'en', now: NOON });
    const revealRival = await revealToday(t.db, { clerkUserId: rival, language: 'en', now: NOON });
    if (revealCheat.status !== 'revealed' || revealRival.status !== 'revealed') throw new Error('no reveal');
    const big = expectRecorded(
      await submitRun(t.db, {
        clerkUserId: cheat,
        body: buildRun({ issued: revealCheat.issued, shape: humanShape(120), seed: 21 }).body,
        now: NOON + 70_000,
      }),
    );
    const lower = await freeRun(t.db, cheat, { shape: humanShape(70), seed: 22 }, NOON + 200_000);
    expect(big.result.wpmCx).toBeGreaterThan(lower.result.wpmCx);
    expectRecorded(
      await submitRun(t.db, {
        clerkUserId: rival,
        body: buildRun({ issued: revealRival.issued, shape: humanShape(90), seed: 23 }).body,
        now: NOON + 70_000,
      }),
    );
    await runDailyJob(t.db, new Date(NOON + 86_400_000));
    const place = async (name: string) => {
      const [row] = await rowsOf<{ place: number | null }>(
        t.db,
        sql`SELECT d.final_rank::int AS place FROM daily_entries d JOIN profiles p ON p.id = d.profile_id WHERE p.username = ${name} AND d.challenge_day = ${TODAY}::date`,
      );
      return row?.place ?? null;
    };
    const rivalBefore = await place('rival');
    expect(await place('voidme')).toBeLessThan(rivalBefore ?? 0);
    expect(big.pace?.runs).toBe(1);

    const later = new Date(NOON + 90_000_000);
    expect(await voidResult(t.db, { adminClerkId: 'user_admin', now: later, resultId: big.result.id, note: 'bad' })).toBe(true);

    const [best] = await rowsOf<{ wpm: number; result: string }>(
      t.db,
      sql`SELECT wpm_cx::int AS wpm, result_id AS result FROM personal_bests WHERE profile_id = ${id}`,
    );
    expect(best).toEqual({ wpm: lower.result.wpmCx, result: lower.result.id });
    const [ladder] = await rowsOf<{ pace: number; runs: number }>(
      t.db,
      sql`SELECT pace_cx::int AS pace, runs_in_window::int AS runs FROM ladder WHERE profile_id = ${id}`,
    );
    expect(ladder).toEqual({ pace: lower.result.wpmCx, runs: 1 });
    const rollups = await rowsOf<{ runs: number }>(t.db, sql`SELECT sum(runs)::int AS runs FROM daily_rollups WHERE profile_id = ${id}`);
    expect(rollups[0]?.runs).toBe(1);
    const board = await todayBoard(t.db, { day: TODAY, listId: EN_LIST });
    expect(board.rows.map((r) => r.username)).not.toContain('voidme');
    expect(await place('voidme')).toBeNull();
    expect(await place('rival')).toBe((rivalBefore ?? 0) - 1);
    expect(await publicResult(t.db, big.result.id)).toBeNull();
    expect(await audits(id)).toEqual(['void']);

    const own = await progressOf(t.db, { clerkUserId: cheat, now: later });
    expect(own?.runs.find((r) => r.id === big.result.id)?.status).toBe('voided');
    const [row] = await rowsOf<{ reviewed: string | null; ranked: boolean }>(
      t.db,
      sql`SELECT reviewed_at::text AS reviewed, ranked FROM results WHERE id = ${big.result.id}`,
    );
    expect(row?.reviewed).not.toBeNull();
    expect(row?.ranked).toBe(false);
    expect(await voidResult(t.db, { ...admin, resultId: big.result.id })).toBe(false);
  });

  it('removes the ladder row when the only ranked run is voided, and closes reports on the run', async () => {
    const user = await typist(t.db, 'onlyrun');
    const reporter = await typist(t.db, 'reportsvoid');
    const id = await profileIdOf(t.db, user);
    const { result } = await freeRun(t.db, user);
    await fileReport(t.db, { clerkUserId: reporter, target: 'result', resultId: result.id, now });
    await voidResult(t.db, { ...admin, resultId: result.id });
    expect(await count(t.db, 'ladder', sql`profile_id = ${id}`)).toBe(0);
    expect(await count(t.db, 'personal_bests', sql`profile_id = ${id}`)).toBe(0);
    expect(await count(t.db, 'daily_rollups', sql`profile_id = ${id}`)).toBe(0);
    const [report] = await rowsOf<{ status: string }>(t.db, sql`SELECT status FROM reports WHERE result_id = ${result.id}`);
    expect(report?.status).toBe('upheld');
  });
});

describe('releasing a hold', () => {
  it('lists the reason for the reviewer, stamps reviewed_at and ranks the run', async () => {
    const saved = process.env.PLAUSIBILITY;
    process.env.PLAUSIBILITY = PLAUSIBILITY_FIXTURE_JSON;
    const user = await typist(t.db, 'reviewed');
    const id = await profileIdOf(t.db, user);
    const { result } = await freeRun(t.db, user, { shape: constantShape(170) });
    if (saved === undefined) delete process.env.PLAUSIBILITY;
    else process.env.PLAUSIBILITY = saved;
    expect(result.status).toBe('held');
    const queue = await heldRuns(t.db, 500);
    expect(queue.find((r) => r.id === result.id)?.reasons).toContain('iki-cv');

    expect(await releaseHold(t.db, { ...admin, resultId: result.id })).toBe(true);
    const [row] = await rowsOf<{ status: string; ranked: boolean; reviewed: string | null }>(
      t.db,
      sql`SELECT status, ranked, reviewed_at::text AS reviewed FROM results WHERE id = ${result.id}`,
    );
    expect(row?.status).toBe('passed');
    expect(row?.ranked).toBe(true);
    expect(row?.reviewed).not.toBeNull();
    expect(await count(t.db, 'ladder', sql`profile_id = ${id}`)).toBe(1);
    expect(await count(t.db, 'personal_bests', sql`profile_id = ${id}`)).toBe(1);
    expect(await audits(id)).toEqual(['release']);
    expect(await releaseHold(t.db, { ...admin, resultId: result.id })).toBe(false);
    expect((await heldRuns(t.db, 500)).find((r) => r.id === result.id)).toBeUndefined();
  });
});

describe('bans', () => {
  it('removes someone from public surfaces, and is visible to them, with no auto action anywhere', async () => {
    const user = await typist(t.db, 'bannedone');
    const id = await profileIdOf(t.db, user);
    await insertRanked(t.db, id, Array(10).fill(7000) as number[], (i) => new Date(NOON - i * 60_000));
    await recomputeLadder(t.db, id, EN_LIST, now);
    const reveal = await revealToday(t.db, { clerkUserId: user, language: 'en', now: NOON });
    if (reveal.status !== 'revealed') throw new Error('no reveal');
    expectRecorded(await submitRun(t.db, { clerkUserId: user, body: buildRun({ issued: reveal.issued }).body, now: NOON + 70_000 }));
    expect((await standings(t.db, { listId: EN_LIST })).eligible).toBeGreaterThan(0);

    expect(await banProfile(t.db, { ...admin, profileId: id })).toBe(true);
    expect((await todayBoard(t.db, { day: TODAY, listId: EN_LIST })).rows.map((r) => r.username)).not.toContain('bannedone');
    expect(await count(t.db, 'ladder', sql`profile_id = ${id} AND eligible`)).toBe(0);
    expect(await publicProfile(t.db, 'bannedone')).toBeNull();
    expect((await progressOf(t.db, { clerkUserId: user, now }))?.bannedAt).toEqual(now);
    expect(await audits(id)).toEqual(['ban']);
    expect(await yourToday(t.db, { clerkUserId: user, day: TODAY, listId: EN_LIST })).toMatchObject({ onBoard: false });
    expect(await revealToday(t.db, { clerkUserId: user, language: 'en', now: NOON + 86_400_000 })).toEqual({
      status: 'not-eligible',
      missing: ['banned'],
    });
    const after = await freeRun(t.db, user, {}, NOON + 200_000);
    expect(after.result.ranked).toBe(false);
  });

  it('reports false for nobody', async () => {
    expect(await banProfile(t.db, { ...admin, profileId: 99_999_999 })).toBe(false);
  });
});

describe('forced rename', () => {
  it('gives a generated name, holds the old one and audits it', async () => {
    const user = await typist(t.db, 'badname');
    const reporter = await typist(t.db, 'namereporter');
    const id = await profileIdOf(t.db, user);
    await fileReport(t.db, { clerkUserId: reporter, target: 'username', username: 'badname', now });
    const name = await forceRename(t.db, { ...admin, profileId: id });
    expect(name).toMatch(/^typist-\d{5}$/);
    expect((await findProfile(t.db, user))?.username).toBe(name);
    expect(await count(t.db, 'username_holds', sql`username = 'badname'`)).toBe(1);
    expect(await audits(id)).toEqual(['rename']);
    const [report] = await rowsOf<{ status: string }>(t.db, sql`SELECT status FROM reports WHERE subject_id = ${id}`);
    expect(report?.status).toBe('upheld');
    await t.db.execute(sql`INSERT INTO profiles (clerk_user_id) VALUES ('user_nameless')`);
    expect(await forceRename(t.db, { ...admin, profileId: await profileIdOf(t.db, 'user_nameless') })).toBeNull();
  });

  it('retries when a generated name collides', async () => {
    const user = await typist(t.db, 'collides');
    const id = await profileIdOf(t.db, user);
    await t.db.execute(sql`INSERT INTO profiles (clerk_user_id, username) VALUES ('user_collision', 'typist-10000')`);
    const random = vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.5);
    expect(await forceRename(t.db, { ...admin, profileId: id })).toBe('typist-55000');
    random.mockRestore();
  });
});

describe('the daily job', () => {
  const job = new Date(Date.UTC(2027, 0, 20, 6, 30));
  const day = 86_400_000;

  it('purges what has expired, keeps what has not, and is idempotent', async () => {
    const user = await typist(t.db, 'jobber');
    const id = await profileIdOf(t.db, user);
    await t.db.execute(
      sql`INSERT INTO replays (result_id, profile_id, log, purge_after) VALUES (gen_random_uuid(), ${id}, '\\x01'::bytea, ${new Date(job.getTime() - 1000).toISOString()}::timestamptz), (gen_random_uuid(), ${id}, '\\x01'::bytea, ${new Date(job.getTime() + 1000).toISOString()}::timestamptz)`,
    );
    await t.db.execute(
      sql`INSERT INTO key_stats (profile_id, list_id, week_start, counts) VALUES (${id}, ${EN_LIST}, '2026-01-05', '\\x00'::bytea), (${id}, ${EN_LIST}, '2027-01-04', '\\x00'::bytea)`,
    );
    await t.db.execute(
      sql`INSERT INTO username_holds (username, profile_id, release_at) VALUES ('expiredhold', ${id}, ${new Date(job.getTime() - 1000).toISOString()}::timestamptz), ('livehold', ${id}, ${new Date(job.getTime() + 1000).toISOString()}::timestamptz)`,
    );
    await t.db.execute(
      sql`INSERT INTO rate_counters VALUES (${id}, 'submit', ${new Date(job.getTime() - 3 * day).toISOString()}::timestamptz, 1), (${id}, 'submit', ${job.toISOString()}::timestamptz, 1)`,
    );
    await t.db.execute(
      sql`INSERT INTO reports (target, reporter_id, subject_id, status, resolved_at) VALUES ('username', null, ${id}, 'dismissed', ${new Date(job.getTime() - 366 * day).toISOString()}::timestamptz), ('username', null, ${id}, 'dismissed', ${new Date(job.getTime() - 30 * day).toISOString()}::timestamptz)`,
    );

    const check = async () => {
      expect(await count(t.db, 'replays', sql`profile_id = ${id}`)).toBe(1);
      expect(await count(t.db, 'key_stats', sql`profile_id = ${id}`)).toBe(1);
      expect(await count(t.db, 'username_holds', sql`profile_id = ${id}`)).toBe(1);
      expect(await count(t.db, 'rate_counters', sql`profile_id = ${id}`)).toBe(1);
      expect(await count(t.db, 'reports', sql`subject_id = ${id}`)).toBe(1);
    };
    await runDailyJob(t.db, job);
    await check();
    await runDailyJob(t.db, job);
    await check();
  });

  it('sets final ranks for finished days, with ties shared, and leaves today alone', async () => {
    const finished = '2027-01-19';
    const running = '2027-01-20';
    const names = ['fr_a', 'fr_b', 'fr_c', 'fr_d'];
    const scores: [number, number][] = [
      [9000, 9500],
      [9000, 9500],
      [8000, 10000],
      [7000, 9000],
    ];
    for (const [i, name] of names.entries()) {
      const id = await profileIdOf(t.db, await typist(t.db, name));
      const [wpm, acc] = scores[i] ?? [0, 0];
      for (const when of [finished, running]) {
        await t.db.execute(
          sql`INSERT INTO daily_entries (challenge_day, list_id, profile_id, ticket_nonce, wpm_cx, accuracy_bp, finished_at, visible) VALUES (${when}::date, ${EN_LIST}, ${id}, gen_random_uuid(), ${wpm}, ${acc}, now(), ${i !== 3 || when === running})`,
        );
      }
    }
    await runDailyJob(t.db, job);
    await runDailyJob(t.db, job);
    const rows = await rowsOf<{ u: string; place: number | null }>(
      t.db,
      sql`SELECT p.username AS u, d.final_rank::int AS place FROM daily_entries d JOIN profiles p ON p.id = d.profile_id WHERE d.challenge_day = ${finished}::date ORDER BY p.username`,
    );
    expect(rows).toEqual([
      { u: 'fr_a', place: 1 },
      { u: 'fr_b', place: 1 },
      { u: 'fr_c', place: 3 },
      { u: 'fr_d', place: null },
    ]);
    const today = await rowsOf<{ place: number | null }>(
      t.db,
      sql`SELECT final_rank::int AS place FROM daily_entries WHERE challenge_day = ${running}::date`,
    );
    expect(today.every((r) => r.place === null)).toBe(true);
  });

  it('drops an inactive typist from Standings at 30 days and recomputes Pace as runs age out', async () => {
    const quiet = await typist(t.db, 'gonequiet');
    const id = await profileIdOf(t.db, quiet);
    const lastRun = new Date(job.getTime() - 31 * day);
    const values = [...(Array(10).fill(6000) as number[]), ...(Array(5).fill(9000) as number[])];
    await insertRanked(t.db, id, values, (i) => new Date(lastRun.getTime() - (i < 10 ? i * 60_000 : 80 * day + i)));
    const before = await recomputeLadder(t.db, id, EN_LIST, new Date(lastRun.getTime() + 1000));
    expect(before).toMatchObject({ eligible: true, runs: 15 });
    await runDailyJob(t.db, job);
    const [row] = await rowsOf<{ eligible: boolean; pace: number; runs: number }>(
      t.db,
      sql`SELECT eligible, pace_cx::int AS pace, runs_in_window::int AS runs FROM ladder WHERE profile_id = ${id}`,
    );
    expect(row).toEqual({ eligible: false, pace: 6000, runs: 10 });
    await runDailyJob(t.db, job);
    await runDailyJob(t.db, new Date(job.getTime() + 60 * day));
    expect(await count(t.db, 'ladder', sql`profile_id = ${id}`)).toBe(0);
  });
});
