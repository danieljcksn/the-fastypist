import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dismissReport, fileReport, forceRename, banProfile, releaseHold, voidResult } from '@/server/moderation';
import { publicProfile, publicResult, publicSeed, standings, todayBoard, wouldHavePlaced, yourToday } from '@/server/ranking';
import { type TestDb, createTestDb } from './helpers/db';
import { EN_LIST, NOON, TODAY, setSecrets, typist } from './helpers/world';

// A URL segment or a query value reaches these unchecked, and a query Postgres refuses would answer a typo with a 500.
describe('input a route passes straight through', () => {
  let t: TestDb;
  let restore: () => void;
  const now = new Date(NOON);
  const admin = { adminClerkId: 'user_admin', now };
  const PAST = '2026-01-01';

  beforeAll(async () => {
    restore = setSecrets();
    t = await createTestDb();
  });
  afterAll(async () => {
    restore();
    await t.close();
  });

  it.each(['not-a-uuid', "'; DROP TABLE results; --", '', 'a\u0000b', '%00'])('finds no result at %j', async (id) => {
    expect(await publicResult(t.db, id)).toBeNull();
  });

  it.each(['a\u0000b', 'x'.repeat(100_000), "' OR 1=1 --", '', 'ana/../admin'])('finds no profile at %j', async (name) => {
    expect(await publicProfile(t.db, name)).toBeNull();
  });

  it('finds a profile in any case', async () => {
    await typist(t.db, 'caseana');
    expect(await publicProfile(t.db, 'CaseAna')).toMatchObject({ username: 'caseana' });
  });

  it.each(['garbage', '1', '0000-01-01', '2026-13-45', '2026-02-30', '2026-1-1', '', 'a\u0000'])('treats %j as no day', async (day) => {
    expect(await publicSeed(t.db, { day, language: 'en', now: NOON })).toBeNull();
    expect(await wouldHavePlaced(t.db, { day, language: 'en', wpmCx: 100, accuracyBp: 100, now: NOON })).toBeNull();
    expect(await todayBoard(t.db, { day, listId: EN_LIST })).toEqual({ total: 0, rows: [] });
    expect(await yourToday(t.db, { clerkUserId: 'user_nobody', day, listId: EN_LIST })).toBeNull();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e30, -1])('reads page %s as the first or an empty page', async (page) => {
    expect((await todayBoard(t.db, { day: TODAY, listId: EN_LIST, page })).rows).toEqual([]);
    expect((await standings(t.db, { listId: EN_LIST, page })).rows).toEqual([]);
  });

  it('truncates a fractional page rather than offsetting by half of one', async () => {
    expect((await todayBoard(t.db, { day: TODAY, listId: EN_LIST, page: 1.5 })).rows).toEqual([]);
  });

  it.each([
    [1e15, 100],
    [Number.NaN, 100],
    [1.5, 100],
    [-1, 100],
    [100, 1.5],
    [100, 10_001],
    [100, Number.NaN],
  ])('takes no placing for a guest claiming %s at %s', async (wpmCx, accuracyBp) => {
    expect(await wouldHavePlaced(t.db, { day: PAST, language: 'en', wpmCx, accuracyBp, now: NOON })).toBeNull();
  });

  it('files no report on what cannot exist', async () => {
    const notFound = { ok: false, reason: 'not-found' };
    expect(await fileReport(t.db, { clerkUserId: 'user_rep', target: 'result', resultId: 'junk', now })).toEqual(notFound);
    expect(await fileReport(t.db, { clerkUserId: 'user_rep', target: 'username', username: 'a\u0000', now })).toEqual(notFound);
  });

  it('finds the name in a report in any case, and stores a note without the byte Postgres refuses', async () => {
    await typist(t.db, 'nulnote');
    const outcome = await fileReport(t.db, { clerkUserId: 'user_rep', target: 'username', username: 'NulNote', note: 'x\u0000y', now });
    expect(outcome).toMatchObject({ ok: true });
  });

  it('acts on nothing for a moderator’s bad reference', async () => {
    expect(await releaseHold(t.db, { ...admin, resultId: 'junk' })).toBe(false);
    expect(await voidResult(t.db, { ...admin, resultId: 'junk' })).toBe(false);
    expect(await dismissReport(t.db, { ...admin, reportId: Number.NaN })).toBe(false);
    expect(await banProfile(t.db, { ...admin, profileId: Number.NaN })).toBe(false);
    expect(await forceRename(t.db, { ...admin, profileId: Number.NaN })).toBeNull();
  });
});
