import { sql } from 'drizzle-orm';
import { type Db, rowsOf } from '@/db/client';
import { LIST_IDS } from '@/db/lists';
import { RANKED_PACK } from '@/engine/packs';
import { optIntoRanking } from '@/server/accounts';
import { type SubmitOutcome, submitRun } from '@/server/ranking';
import { type BuildOptions, buildRun } from './submissions';

export const EN_LIST = LIST_IDS[RANKED_PACK.en];
// 2026-11-06 12:00 UTC: on challenge day 2026-11-06.
export const NOON = Date.UTC(2026, 10, 6, 12, 0, 0);
export const TODAY = '2026-11-06';
export const SECRETS = {
  TICKET_SECRETS: 'k1:test-only-secret-test-only-secret-test-only',
  DAILY_SECRET: 'daily-test-secret-daily-test-secret-daily',
};

export function setSecrets(): () => void {
  const saved = { t: process.env.TICKET_SECRETS, d: process.env.DAILY_SECRET };
  process.env.TICKET_SECRETS = SECRETS.TICKET_SECRETS;
  process.env.DAILY_SECRET = SECRETS.DAILY_SECRET;
  return () => {
    if (saved.t === undefined) delete process.env.TICKET_SECRETS;
    else process.env.TICKET_SECRETS = saved.t;
    if (saved.d === undefined) delete process.env.DAILY_SECRET;
    else process.env.DAILY_SECRET = saved.d;
  };
}

export async function typist(db: Db, name: string, listed = true): Promise<string> {
  const clerkUserId = `user_${name}`;
  const outcome = await optIntoRanking(db, { clerkUserId, username: name, listed, now: new Date(NOON) });
  if (!outcome.ok) throw new Error(`could not claim ${name}: ${outcome.problem}`);
  return clerkUserId;
}

export async function profileIdOf(db: Db, clerkUserId: string): Promise<number> {
  const [row] = await rowsOf<{ id: number }>(db, sql`SELECT id::int FROM profiles WHERE clerk_user_id = ${clerkUserId}`);
  if (!row) throw new Error('no such profile');
  return row.id;
}

export type Recorded = Extract<SubmitOutcome, { status: 'recorded' }>;

export function expectRecorded(outcome: SubmitOutcome): Recorded {
  if (outcome.status !== 'recorded') throw new Error(`not recorded: ${JSON.stringify(outcome)}`);
  return outcome;
}

/** A free 60 s ranked run submitted just after it could have finished. */
export async function freeRun(db: Db, clerkUserId: string, options: BuildOptions = {}, at = NOON): Promise<Recorded> {
  const built = buildRun({ iat: at, ...options });
  return expectRecorded(await submitRun(db, { clerkUserId, body: built.body, now: at + 70_000 }));
}

export async function count(db: Db, table: string, where = sql`true`): Promise<number> {
  const [row] = await rowsOf<{ n: number }>(db, sql`SELECT count(*)::int AS n FROM ${sql.raw(table)} WHERE ${where}`);
  return row?.n ?? 0;
}

/** Ranked results written straight into the table, for tests about what is computed from them. */
export async function insertRanked(
  db: Db,
  profileId: number,
  values: readonly number[],
  finishedAt: (i: number) => Date,
  listId = EN_LIST,
): Promise<void> {
  for (const [i, wpmCx] of values.entries()) {
    const when = finishedAt(i);
    await db.execute(sql`
      INSERT INTO results (id, profile_id, list_id, kind, status, ranked, rankable, mode, amount, wpm_cx, raw_cx, accuracy_bp, elapsed_ms, seed, scorer_version, body_hash, device, local_day, finished_at)
      VALUES (gen_random_uuid(), ${profileId}, ${listId}, 'free', 'passed', true, true, 'time', 60, ${wpmCx}, ${wpmCx}, 9700, 60000, '\\x00'::bytea, 1, '\\x00'::bytea, 'keyboard', ${when.toISOString().slice(0, 10)}::date, ${when.toISOString()}::timestamptz)
    `);
  }
}
