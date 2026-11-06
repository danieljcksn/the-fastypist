import { type SQL, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '@/db/client';
import { placeOf, rankedListId, standings, todayBoard, yourStanding, yourToday } from '@/server/ranking';
import { offerBest, recomputeLadder } from '@/server/standing';
import { type TestDb, createTestDb } from './helpers/db';
import { EN_LIST, profileIdOf } from './helpers/world';

const DAY = '2026-11-06';
const PROFILES = 3000;
const PT_LIST = rankedListId('pt');
let t: TestDb;

/** Runs the functions' real queries and records each plan, so these can't drift from the SQL they claim to test. */
function explaining(db: Db): { db: Db; plans: string[] } {
  const plans: string[] = [];
  const proxy = new Proxy(db, {
    get(target, key, receiver) {
      if (key !== 'execute') return Reflect.get(target, key, receiver) as unknown;
      return async (query: SQL) => {
        const explained = (await target.execute(sql`EXPLAIN ${query}`)) as unknown as { rows: { 'QUERY PLAN': string }[] };
        plans.push(explained.rows.map((row) => row['QUERY PLAN']).join('\n'));
        return target.execute(query);
      };
    },
  });
  return { db: proxy, plans };
}

beforeAll(async () => {
  t = await createTestDb();
  await t.db.execute(sql`
    INSERT INTO profiles (clerk_user_id, username, ranking_consent_at, listed_at)
    SELECT 'user_' || g, 'typist' || g, now(), now() FROM generate_series(1, ${PROFILES}) g
  `);
  await t.db.execute(sql`
    INSERT INTO daily_entries (challenge_day, list_id, profile_id, ticket_nonce, wpm_cx, accuracy_bp, finished_at, visible)
    SELECT d, list, p.id, gen_random_uuid(), 4000 + (p.id * 7919 + extract(doy from d)::int) % 9000, 8500 + p.id % 1500, timestamptz '2026-11-06 12:00' + p.id * interval '1 second', p.id % 10 <> 0
    FROM profiles p
    CROSS JOIN generate_series(date '2026-11-03', date '2026-11-06', interval '1 day') d
    CROSS JOIN (VALUES (${EN_LIST}::smallint), (${PT_LIST}::smallint)) AS lists (list)
  `);
  await t.db.execute(sql`
    INSERT INTO ladder (profile_id, list_id, pace_cx, best_cx, runs_in_window, last_ranked_at, oldest_in_window_at, eligible)
    SELECT id, list, 4000 + (id * 104729) % 9000, 9000, 25, now(), now(), id % 10 <> 0
    FROM profiles CROSS JOIN (VALUES (${EN_LIST}::smallint), (${PT_LIST}::smallint)) AS lists (list)
  `);
  await t.db.execute(sql`
    INSERT INTO results (id, profile_id, list_id, kind, status, ranked, rankable, mode, amount, wpm_cx, raw_cx, accuracy_bp, elapsed_ms, seed, scorer_version, body_hash, device, local_day, finished_at)
    SELECT gen_random_uuid(), p.id, ${EN_LIST}, 'free', 'passed', g % 2 = 0, g % 2 = 0, 'time', 60, 6000 + g, 6000, 9700, 60000, '\\x00'::bytea, 1, '\\x00'::bytea, 'keyboard', date '2026-11-01', timestamptz '2026-11-01' + g * interval '1 minute'
    FROM (SELECT id FROM profiles WHERE id <= 50) p CROSS JOIN generate_series(1, 80) g
  `);
  await t.db.execute(sql`
    INSERT INTO personal_bests (profile_id, list_id, mode, amount, wpm_cx, accuracy_bp, result_id, achieved_at)
    SELECT id, ${EN_LIST}, 'time', 60, 7000, 9500, gen_random_uuid(), now() FROM profiles
  `);
  // A long-running database has its visibility map set by autovacuum, which is what lets a count stay index-only.
  await t.db.execute(sql`VACUUM ANALYZE`);
});
afterAll(() => t.close());

describe('query plans at a few thousand rows', () => {
  it('reads today’s board from its index, with no sort and no sequential scan', async () => {
    const { db, plans } = explaining(t.db);
    const board = await todayBoard(db, { day: DAY, listId: EN_LIST });
    expect(board.rows).toHaveLength(50);
    expect(board.total).toBe(2700);
    for (const plan of plans) {
      expect(plan).toContain('daily_board_idx');
      expect(plan).not.toContain('Seq Scan on daily_entries');
    }
    expect(plans[1]).not.toMatch(/Sort Key: daily_entries/);
  });

  it('reads a deep page from the same index', async () => {
    const { db, plans } = explaining(t.db);
    await todayBoard(db, { day: DAY, listId: EN_LIST, page: 40 });
    expect(plans[1]).toContain('daily_board_idx');
    expect(plans[1]).not.toContain('Seq Scan on daily_entries');
  });

  it('counts a place from the index', async () => {
    const { db, plans } = explaining(t.db);
    await placeOf(db, DAY, EN_LIST, 8000, 9000);
    expect(plans[0]).toContain('daily_board_idx');
    expect(plans[0]).not.toContain('Seq Scan');
  });

  it('finds your neighbours from the index', async () => {
    const { db, plans } = explaining(t.db);
    const mine = await yourToday(db, { clerkUserId: 'user_123', day: DAY, listId: EN_LIST });
    expect(mine?.above).toHaveLength(2);
    expect(mine?.below).toHaveLength(2);
    expect(plans.length).toBeGreaterThan(2);
    for (const plan of plans) {
      expect(plan).toContain('daily_board_idx');
      expect(plan).not.toContain('Seq Scan on daily_entries');
    }
  });

  it('reads Standings from its index', async () => {
    const { db, plans } = explaining(t.db);
    const board = await standings(db, { listId: EN_LIST });
    expect(board.shown).toBe(true);
    expect(board.rows).toHaveLength(50);
    for (const plan of plans) {
      expect(plan).toContain('ladder_board_idx');
      expect(plan).not.toContain('Seq Scan on ladder');
    }
  });

  it('finds your Standing from the index', async () => {
    const { db, plans } = explaining(t.db);
    const mine = await yourStanding(db, { clerkUserId: 'user_123', listId: EN_LIST });
    expect(mine?.above).toHaveLength(2);
    expect(plans.length).toBeGreaterThan(1);
    for (const plan of plans) expect(plan).toContain('ladder_board_idx');
  });

  it('recomputes Pace from the ranked index, whatever an account’s size', async () => {
    const { db, plans } = explaining(t.db);
    const id = await profileIdOf(t.db, 'user_7');
    const pace = await recomputeLadder(db, id, EN_LIST, new Date('2026-11-06T12:00:00Z'));
    expect(pace?.runs).toBe(25);
    expect(plans[0]).toContain('results_ranked_idx');
    expect(plans[0]).not.toContain('Seq Scan on results');
  });

  it('reports a best through the primary key', async () => {
    const { db, plans } = explaining(t.db);
    const id = await profileIdOf(t.db, 'user_8');
    await offerBest(
      db,
      { profileId: id, listId: EN_LIST, mode: 'time', amount: 60 },
      { wpmCx: 7000, accuracyBp: 9700, resultId: '00000000-0000-4000-8000-000000000001', at: new Date('2026-11-06T12:00:00Z') },
    );
    expect(plans[0]).not.toContain('Seq Scan on personal_bests');
  });
});
