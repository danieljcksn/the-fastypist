import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rowsOf } from '@/db/client';
import {
  IMPORT_CAP,
  claimUsername,
  deleteAccount,
  ensureProfile,
  findProfile,
  importHistory,
  optIntoRanking,
  setListed,
  withdrawRankingConsent,
} from '@/server/accounts';
import { fileReport } from '@/server/moderation';
import { progressOf, publicProfile, publicResult, revealToday, submitRun, todayBoard } from '@/server/ranking';
import { type TestDb, createTestDb } from './helpers/db';
import { buildRun } from './helpers/submissions';
import { EN_LIST, NOON, TODAY, count, expectRecorded, freeRun, profileIdOf, setSecrets, typist } from './helpers/world';

let t: TestDb;
let restore: () => void;
const now = new Date(NOON);

beforeAll(async () => {
  restore = setSecrets();
  t = await createTestDb();
});
afterAll(async () => {
  restore();
  await t.close();
});

describe('profiles', () => {
  it('upserts lazily, with no username until someone opts in', async () => {
    const first = await ensureProfile(t.db, 'user_lazy');
    const second = await ensureProfile(t.db, 'user_lazy');
    expect(second.id).toBe(first.id);
    expect(first).toMatchObject({ username: null, rankingConsentAt: null, listedAt: null });
  });

  it('records each consent as a timestamp of its own', async () => {
    const at = new Date(NOON - 5000);
    await optIntoRanking(t.db, { clerkUserId: 'user_consent', username: 'consenter', listed: false, now: at });
    expect(await findProfile(t.db, 'user_consent')).toMatchObject({ username: 'consenter', rankingConsentAt: at, listedAt: null });
    expect(await publicProfile(t.db, 'consenter')).toBeNull();
    await setListed(t.db, { clerkUserId: 'user_consent', listed: true, now });
    expect(await findProfile(t.db, 'user_consent')).toMatchObject({ rankingConsentAt: at, listedAt: now });
    expect(await publicProfile(t.db, 'consenter')).not.toBeNull();
  });

  it('refuses to list someone with no consent', async () => {
    await ensureProfile(t.db, 'user_unconsented');
    expect(await setListed(t.db, { clerkUserId: 'user_unconsented', listed: true, now })).toBe(false);
    expect(await setListed(t.db, { clerkUserId: 'user_ghost', listed: true, now })).toBe(false);
  });

  it('takes a run off the board when listing is withdrawn and puts it back after', async () => {
    const user = await typist(t.db, 'togglelist');
    const reveal = await revealToday(t.db, { clerkUserId: user, language: 'en', now: NOON });
    if (reveal.status !== 'revealed') throw new Error('no reveal');
    expectRecorded(await submitRun(t.db, { clerkUserId: user, body: buildRun({ issued: reveal.issued }).body, now: NOON + 70_000 }));
    const names = async () => (await todayBoard(t.db, { day: TODAY, listId: EN_LIST })).rows.map((r) => r.username);
    expect(await names()).toContain('togglelist');
    await setListed(t.db, { clerkUserId: user, listed: false, now });
    expect(await names()).not.toContain('togglelist');
    await setListed(t.db, { clerkUserId: user, listed: true, now });
    expect(await names()).toContain('togglelist');
  });

  it('stops ranking and erases flight times on withdrawal, keeping the results', async () => {
    const user = await typist(t.db, 'withdrawer');
    const id = await profileIdOf(t.db, user);
    const reveal = await revealToday(t.db, { clerkUserId: user, language: 'en', now: NOON });
    if (reveal.status !== 'revealed') throw new Error('no reveal');
    expectRecorded(await submitRun(t.db, { clerkUserId: user, body: buildRun({ issued: reveal.issued }).body, now: NOON + 70_000 }));
    expect(await count(t.db, 'replays', sql`profile_id = ${id}`)).toBe(1);
    await withdrawRankingConsent(t.db, { clerkUserId: user, now });
    expect(await count(t.db, 'replays', sql`profile_id = ${id}`)).toBe(0);
    expect(await count(t.db, 'results', sql`profile_id = ${id}`)).toBe(1);
    expect((await todayBoard(t.db, { day: TODAY, listId: EN_LIST })).rows.map((r) => r.username)).not.toContain('withdrawer');
    const after = await freeRun(t.db, user, {}, NOON + 200_000);
    expect(after.result.ranked).toBe(false);
  });
});

describe('usernames', () => {
  it('normalizes, then checks format, reserved names and offensive words', async () => {
    expect(await claimUsername(t.db, { clerkUserId: 'user_a1', username: '  Mixed-Case ', now })).toEqual({
      ok: true,
      username: 'mixed-case',
    });
    expect(await claimUsername(t.db, { clerkUserId: 'user_a2', username: 'x', now })).toEqual({ ok: false, problem: 'format' });
    expect(await claimUsername(t.db, { clerkUserId: 'user_a2', username: 'admin', now })).toEqual({ ok: false, problem: 'reserved' });
    expect(await claimUsername(t.db, { clerkUserId: 'user_a2', username: 'p0rra', now })).toEqual({ ok: false, problem: 'offensive' });
  });

  it('refuses a name someone has', async () => {
    await claimUsername(t.db, { clerkUserId: 'user_b1', username: 'takenname', now });
    expect(await claimUsername(t.db, { clerkUserId: 'user_b2', username: 'TakenName', now })).toEqual({ ok: false, problem: 'taken' });
    expect(await claimUsername(t.db, { clerkUserId: 'user_b1', username: 'takenname', now })).toEqual({ ok: true, username: 'takenname' });
  });

  it('holds a renamed name for 30 days, except for its old owner', async () => {
    await claimUsername(t.db, { clerkUserId: 'user_c1', username: 'oldname', now });
    await claimUsername(t.db, { clerkUserId: 'user_c1', username: 'newname', now });
    const day = 86_400_000;
    expect(await claimUsername(t.db, { clerkUserId: 'user_c2', username: 'oldname', now: new Date(NOON + 29 * day) })).toEqual({
      ok: false,
      problem: 'held',
    });
    expect(await claimUsername(t.db, { clerkUserId: 'user_c1', username: 'oldname', now: new Date(NOON + 29 * day) })).toEqual({
      ok: true,
      username: 'oldname',
    });
    await claimUsername(t.db, { clerkUserId: 'user_c1', username: 'thirdname', now });
    expect(await claimUsername(t.db, { clerkUserId: 'user_c2', username: 'oldname', now: new Date(NOON + 31 * day) })).toEqual({
      ok: true,
      username: 'oldname',
    });
  });
});

describe('import', () => {
  const row = (i: number, over: Record<string, unknown> = {}) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    pack: 'en-1k@1',
    mode: 'time',
    amount: 60,
    wpmCx: 99_000,
    rawCx: 99_000,
    accuracyBp: 10_000,
    consistencyBp: 9000,
    elapsedMs: 60_000,
    finishedAt: new Date(NOON - i * 60_000).toISOString(),
    localDay: '2026-11-05',
    ...over,
  });

  it('is private: no board, no best, no Pace, no rollup, however good the claim', async () => {
    const user = await typist(t.db, 'importer');
    const id = await profileIdOf(t.db, user);
    expect(await importHistory(t.db, { clerkUserId: user, rows: [row(1), row(2)], now })).toEqual({ imported: 2, skipped: 0 });
    const [stored] = await rowsOf<{ kind: string; status: string; ranked: boolean }>(
      t.db,
      sql`SELECT kind, status, ranked FROM results WHERE profile_id = ${id} LIMIT 1`,
    );
    expect(stored).toEqual({ kind: 'import', status: 'unverified', ranked: false });
    for (const table of ['personal_bests', 'ladder', 'daily_rollups', 'daily_entries', 'key_stats', 'replays']) {
      expect(await count(t.db, table, sql`profile_id = ${id}`), table).toBe(0);
    }
    expect(await publicResult(t.db, row(1).id)).toBeNull();
    expect(await publicProfile(t.db, 'importer')).toMatchObject({ rankedRuns: 0, bests: [], paces: [], lastDays: [] });
    const progress = await progressOf(t.db, { clerkUserId: user, now });
    expect(progress?.runs.map((r) => r.kind)).toEqual(['import', 'import']);
    expect(progress?.bests).toEqual([]);
  });

  it('leaves a real best and Pace untouched when a huge claim arrives after them', async () => {
    const user = await typist(t.db, 'importafter');
    const id = await profileIdOf(t.db, user);
    const real = await freeRun(t.db, user);
    await importHistory(t.db, {
      clerkUserId: user,
      rows: [row(50, { id: '00000000-0000-4000-8000-0000000000aa', finishedAt: new Date(NOON + 100).toISOString() })],
      now: new Date(NOON + 1000),
    });
    const [best] = await rowsOf<{ wpm: number }>(t.db, sql`SELECT wpm_cx::int AS wpm FROM personal_bests WHERE profile_id = ${id}`);
    expect(best?.wpm).toBe(real.result.wpmCx);
    const again = await freeRun(t.db, user, { seed: 9 }, NOON + 200_000);
    expect(again.pace?.runs).toBe(2);
    expect(again.pace?.paceCx).toBeLessThan(20_000);
  });

  it('is idempotent by client uuid', async () => {
    const user = await typist(t.db, 'reimporter');
    await importHistory(t.db, { clerkUserId: user, rows: [row(101), row(102)], now });
    expect(await importHistory(t.db, { clerkUserId: user, rows: [row(101), row(102), row(103)], now })).toEqual({
      imported: 1,
      skipped: 2,
    });
  });

  it('does not let one typist overwrite or see another’s row by uuid', async () => {
    const a = await typist(t.db, 'uuidowner');
    const b = await typist(t.db, 'uuidsquatter');
    await importHistory(t.db, { clerkUserId: a, rows: [row(201, { wpmCx: 5000 })], now });
    expect(await importHistory(t.db, { clerkUserId: b, rows: [row(201, { wpmCx: 9000 })], now })).toEqual({ imported: 0, skipped: 1 });
    const [stored] = await rowsOf<{ wpm: number; owner: number }>(
      t.db,
      sql`SELECT wpm_cx::int AS wpm, profile_id::int AS owner FROM results WHERE id = ${row(201).id}`,
    );
    expect(stored).toEqual({ wpm: 5000, owner: await profileIdOf(t.db, a) });
  });

  it('caps at 500 rows per account across calls, keeping the newest', async () => {
    const user = await typist(t.db, 'overflow');
    const id = await profileIdOf(t.db, user);
    const rows = Array.from({ length: IMPORT_CAP + 20 }, (_, i) => row(1000 + i));
    const first = await importHistory(t.db, { clerkUserId: user, rows, now });
    expect(first.imported).toBe(IMPORT_CAP);
    expect(await count(t.db, 'results', sql`profile_id = ${id}`)).toBe(IMPORT_CAP);
    expect(await count(t.db, 'results', sql`id = ${row(1000).id}`)).toBe(1);
    expect(await count(t.db, 'results', sql`id = ${row(1000 + IMPORT_CAP + 19).id}`)).toBe(0);
    expect((await importHistory(t.db, { clerkUserId: user, rows: [row(5000)], now })).imported).toBe(0);
  });

  it('drops malformed rows and clamps a future date', async () => {
    const user = await typist(t.db, 'sloppy');
    const id = await profileIdOf(t.db, user);
    const rows = [
      row(301),
      { nonsense: true },
      row(302, { accuracyBp: 20_000 }),
      row(303, { ranked: true }),
      row(304, { finishedAt: new Date(NOON + 1e10).toISOString() }),
      row(305, { pack: 'made-up' }),
    ];
    expect(await importHistory(t.db, { clerkUserId: user, rows, now })).toEqual({ imported: 3, skipped: 3 });
    const [future] = await rowsOf<{ at: string }>(
      t.db,
      sql`SELECT to_json(finished_at)#>>'{}' AS at FROM results WHERE id = ${row(304).id}`,
    );
    expect(new Date(future?.at ?? 0).getTime()).toBe(NOON);
    const [unknown] = await rowsOf<{ list: number | null }>(
      t.db,
      sql`SELECT list_id::int AS list FROM results WHERE id = ${row(305).id} AND profile_id = ${id}`,
    );
    expect(unknown?.list).toBeNull();
  });

  it('is held private by the schema itself, not only by this code', async () => {
    const user = await typist(t.db, 'schemaguard');
    await importHistory(t.db, { clerkUserId: user, rows: [row(401)], now });
    await expect(
      t.db.execute(sql`UPDATE results SET ranked = true, rankable = true, status = 'passed' WHERE id = ${row(401).id}`),
    ).rejects.toThrow();
    await expect(t.db.execute(sql`UPDATE results SET new_best = true WHERE id = ${row(401).id}`)).rejects.toThrow();
  });
});

describe('delete', () => {
  it('removes everything by cascade, leaves others alone, and can be repeated', async () => {
    const user = await typist(t.db, 'deleteme');
    const stays = await typist(t.db, 'staying');
    const id = await profileIdOf(t.db, user);
    const stayId = await profileIdOf(t.db, stays);
    const reveal = await revealToday(t.db, { clerkUserId: user, language: 'en', now: NOON });
    if (reveal.status !== 'revealed') throw new Error('no reveal');
    expectRecorded(await submitRun(t.db, { clerkUserId: user, body: buildRun({ issued: reveal.issued }).body, now: NOON + 70_000 }));
    await freeRun(t.db, stays);
    await claimUsername(t.db, { clerkUserId: user, username: 'deleted-too', now });
    const fromThem = await fileReport(t.db, { clerkUserId: user, target: 'username', username: 'staying', note: 'by them', now });
    const aboutThem = await fileReport(t.db, { clerkUserId: stays, target: 'username', username: 'deleted-too', note: 'about them', now });
    expect(fromThem.ok && aboutThem.ok).toBe(true);
    const tables = [
      'results',
      'daily_entries',
      'ladder',
      'personal_bests',
      'daily_rollups',
      'key_stats',
      'replays',
      'rate_counters',
      'username_holds',
    ];
    for (const table of [
      'results',
      'daily_entries',
      'ladder',
      'personal_bests',
      'daily_rollups',
      'key_stats',
      'replays',
      'rate_counters',
    ]) {
      expect(await count(t.db, table, sql`profile_id = ${id}`), table).toBeGreaterThan(0);
    }

    expect(await deleteAccount(t.db, user)).toBe(true);
    for (const table of tables) expect(await count(t.db, table, sql`profile_id = ${id}`), table).toBe(0);
    expect(await count(t.db, 'profiles', sql`id = ${id}`)).toBe(0);
    expect(await count(t.db, 'reports', sql`subject_id = ${id}`)).toBe(0);
    const [kept] = await rowsOf<{ reporter: number | null; note: string }>(
      t.db,
      sql`SELECT reporter_id::int AS reporter, note FROM reports WHERE subject_id = ${stayId}`,
    );
    expect(kept).toEqual({ reporter: null, note: 'by them' });
    expect(await count(t.db, 'results', sql`profile_id = ${stayId}`)).toBe(1);
    expect(await deleteAccount(t.db, user)).toBe(false);
  });

  it('takes under a second on an account of a few thousand rows', async () => {
    const user = await typist(t.db, 'heavy');
    const id = await profileIdOf(t.db, user);
    await t.db.execute(sql`
      INSERT INTO results (id, profile_id, list_id, kind, status, ranked, rankable, mode, amount, wpm_cx, raw_cx, accuracy_bp, elapsed_ms, seed, scorer_version, body_hash, device, local_day, finished_at)
      SELECT gen_random_uuid(), ${id}, ${EN_LIST}, 'free', 'passed', true, true, 'time', 60, 6000 + g % 3000, 6000, 9700, 60000, '\\x00'::bytea, 1, '\\x00'::bytea, 'keyboard',
             date '2026-01-01' + (g % 300), timestamptz '2026-01-01' + g * interval '1 hour'
      FROM generate_series(1, 4000) g
    `);
    await t.db.execute(sql`
      INSERT INTO daily_rollups (profile_id, local_day, list_id, mode, amount, runs, ms_typed, wpm_sum_cx, acc_sum_bp, best_wpm_cx)
      SELECT ${id}, date '2020-01-01' + g, ${EN_LIST}, 'time', 60, 1, 60000, 6000, 9700, 6000 FROM generate_series(1, 1500) g
    `);
    await t.db.execute(sql`
      INSERT INTO daily_entries (challenge_day, list_id, profile_id, ticket_nonce, wpm_cx, accuracy_bp, finished_at, visible)
      SELECT date '2020-01-01' + g, ${EN_LIST}, ${id}, gen_random_uuid(), 6000, 9700, now(), true FROM generate_series(1, 1500) g
    `);
    expect(await count(t.db, 'results', sql`profile_id = ${id}`)).toBe(4000);
    const started = performance.now();
    await deleteAccount(t.db, user);
    const elapsed = performance.now() - started;
    expect(await count(t.db, 'results', sql`profile_id = ${id}`)).toBe(0);
    expect(elapsed).toBeLessThan(1000);
    console.log(`account delete at 7,000 rows: ${elapsed.toFixed(0)} ms`);
  });
});

describe('renaming', () => {
  it('stops at 3 changes a day, so nobody can hold a run of names by walking through them', async () => {
    const user = 'user_squatter';
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await claimUsername(t.db, { clerkUserId: user, username: `squat${i}`, now }));
    expect(results.map((r) => r.ok)).toEqual([true, true, true, false, false]);
    expect(results[3]).toEqual({ ok: false, problem: 'rate-limited' });
    expect((await findProfile(t.db, user))?.username).toBe('squat2');
    expect(await count(t.db, 'username_holds', sql`username LIKE 'squat%'`)).toBe(2);
    const tomorrow = new Date(NOON + 86_400_000);
    expect(await claimUsername(t.db, { clerkUserId: user, username: 'squat5', now: tomorrow })).toEqual({ ok: true, username: 'squat5' });
  });

  it('charges nothing for a name it refused, or for the name you already have', async () => {
    const user = 'user_unlucky';
    await claimUsername(t.db, { clerkUserId: 'user_holder', username: 'wantedname', now });
    for (let i = 0; i < 5; i++) expect(await claimUsername(t.db, { clerkUserId: user, username: 'wantedname', now })).toEqual({ ok: false, problem: 'taken' });
    expect(await claimUsername(t.db, { clerkUserId: user, username: 'luckyname', now })).toEqual({ ok: true, username: 'luckyname' });
    for (let i = 0; i < 5; i++) expect(await claimUsername(t.db, { clerkUserId: user, username: 'luckyname', now })).toEqual({ ok: true, username: 'luckyname' });
  });
});
