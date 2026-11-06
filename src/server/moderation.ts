import { and, eq, sql } from 'drizzle-orm';
import { type Db, rowsOf } from '@/db/client';
import { adminAudit, profiles, reports, results } from '@/db/schema';
import { challengeDay } from '@/engine/day';
import { type Profile, applyUsername, ensureProfile, isUniqueViolation } from './accounts';
import { applyRelease, hitCounter } from './ranking';
import { at, recomputeBest, recomputeLadder, recomputeRollup, refreshFinalRanks, refreshVisibility } from './standing';

export const REPORTS_PER_DAY = 5;
export const NOTE_MAX_CHARS = 280;
const FINAL_RANK_LOOKBACK_DAYS = 7;
const KEY_STATS_KEEP_DAYS = 182;
const REPORTS_KEEP_DAYS = 365;
const COUNTERS_KEEP_DAYS = 2;

export type ReportTarget = 'username' | 'result' | 'appeal';

export type ReportOutcome =
  { ok: true; id: number } | { ok: false; reason: 'not-found' | 'self' | 'duplicate' | 'rate-limited' | 'note-too-long' };

/** Reports never act on their own: brigading is easier than abuse at this size. An appeal is a report on your own run. */
export async function fileReport(
  db: Db,
  input: { clerkUserId: string; target: ReportTarget; username?: string; resultId?: string; note?: string; now: Date },
): Promise<ReportOutcome> {
  const onResult = input.target !== 'username';
  if (onResult ? input.resultId === undefined : input.username === undefined) return { ok: false, reason: 'not-found' };
  const note = input.note?.trim() || null;
  if (note !== null && note.length > NOTE_MAX_CHARS) return { ok: false, reason: 'note-too-long' };
  const reporter = await ensureProfile(db, input.clerkUserId);

  let subjectId: number | undefined;
  if (onResult) {
    const [row] = await db
      .select({ profileId: results.profileId })
      .from(results)
      .where(eq(results.id, input.resultId ?? ''))
      .limit(1);
    subjectId = row?.profileId;
  } else {
    const [row] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.username, input.username ?? ''))
      .limit(1);
    subjectId = row?.id;
  }
  if (subjectId === undefined) return { ok: false, reason: 'not-found' };
  const isOwn = subjectId === reporter.id;
  if (input.target === 'appeal' ? !isOwn : isOwn) return { ok: false, reason: 'self' };

  const dayStart = new Date(input.now.getTime() - (input.now.getTime() % 86_400_000));
  try {
    return await db.transaction(async (tx) => {
      if ((await hitCounter(tx, reporter.id, 'report', dayStart)) > REPORTS_PER_DAY) throw new RateLimited();
      const [row] = await tx
        .insert(reports)
        .values({
          target: input.target,
          reporterId: reporter.id,
          subjectId,
          resultId: onResult ? (input.resultId ?? null) : null,
          note,
          createdAt: input.now,
        })
        .returning({ id: reports.id });
      if (!row) throw new Error('report insert returned nothing');
      return { ok: true as const, id: row.id };
    });
  } catch (error) {
    if (error instanceof RateLimited) return { ok: false, reason: 'rate-limited' };
    if (isUniqueViolation(error)) return { ok: false, reason: 'duplicate' };
    throw error;
  }
}

class RateLimited extends Error {}

export async function openReports(db: Db, limit = 100) {
  return rowsOf<{
    id: number;
    target: ReportTarget;
    subject_id: number;
    username: string | null;
    result_id: string | null;
    note: string | null;
    created_at: string;
  }>(
    db,
    sql`
      SELECT r.id::int, r.target, r.subject_id::int, u.username, r.result_id, r.note, to_json(r.created_at)#>>'{}' AS created_at
      FROM reports r JOIN profiles u ON u.id = r.subject_id
      WHERE r.status = 'open'
      ORDER BY r.created_at
      LIMIT ${limit}
    `,
  );
}

export async function heldRuns(db: Db, limit = 100) {
  return rowsOf<{
    id: string;
    profile_id: number;
    username: string | null;
    wpm_cx: number;
    accuracy_bp: number;
    kind: string;
    reasons: string[];
    finished_at: string;
  }>(
    db,
    sql`
      SELECT r.id, r.profile_id::int, u.username, r.wpm_cx::int, r.accuracy_bp::int, r.kind, coalesce(r.hold_reasons, '{}') AS reasons,
             to_json(r.finished_at)#>>'{}' AS finished_at
      FROM results r JOIN profiles u ON u.id = r.profile_id
      WHERE r.status = 'held'
      ORDER BY r.finished_at
      LIMIT ${limit}
    `,
  );
}

interface AdminInput {
  adminClerkId: string;
  note?: string;
  now: Date;
}

async function audit(
  tx: Db,
  input: AdminInput,
  action: 'dismiss' | 'release' | 'void' | 'ban' | 'rename',
  subjectId: number,
  ref: { resultId?: string; reportId?: number } = {},
): Promise<void> {
  await tx.insert(adminAudit).values({
    adminClerkId: input.adminClerkId,
    action,
    subjectId,
    resultId: ref.resultId ?? null,
    reportId: ref.reportId ?? null,
    note: input.note ?? null,
    createdAt: input.now,
  });
}

async function resolveOpenReports(
  tx: Db,
  where: ReturnType<typeof and>,
  status: 'upheld' | 'dismissed',
  input: AdminInput,
  resolution: string,
): Promise<void> {
  await tx
    .update(reports)
    .set({ status, resolvedAt: input.now, resolution })
    .where(and(eq(reports.status, 'open'), where));
}

export async function dismissReport(db: Db, input: AdminInput & { reportId: number }): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(reports)
      .set({ status: 'dismissed', resolvedAt: input.now, resolution: 'dismiss' })
      .where(and(eq(reports.id, input.reportId), eq(reports.status, 'open')))
      .returning({ subjectId: reports.subjectId });
    if (!row) return false;
    await audit(tx, input, 'dismiss', row.subjectId, { reportId: input.reportId });
    return true;
  });
}

/** Reviewed and fine: the run stands, and may now rank if it passed every other gate. */
export async function releaseHold(db: Db, input: AdminInput & { resultId: string }): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [held] = await tx
      .select()
      .from(results)
      .where(and(eq(results.id, input.resultId), eq(results.status, 'held')))
      .for('update');
    if (!held) return false;
    await tx.update(results).set({ status: 'passed', ranked: held.rankable, reviewedAt: input.now }).where(eq(results.id, held.id));
    await applyRelease(tx, held, input.now);
    await resolveOpenReports(tx, eq(reports.resultId, held.id), 'dismissed', input, 'release');
    await audit(tx, input, 'release', held.profileId, { resultId: held.id });
    return true;
  });
}

/** The run stays in the typist's own history, marked. Everything derived from it is rebuilt without it. */
export async function voidResult(db: Db, input: AdminInput & { resultId: string }): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [run] = await tx.select().from(results).where(eq(results.id, input.resultId)).for('update');
    if (!run || run.kind === 'import' || run.status === 'voided') return false;
    await tx.update(results).set({ status: 'voided', ranked: false, rankable: false, reviewedAt: input.now }).where(eq(results.id, run.id));
    if (run.listId !== null) {
      const key = { profileId: run.profileId, listId: run.listId, mode: run.mode, amount: run.amount };
      await recomputeBest(tx, key);
      await recomputeRollup(tx, { ...key, localDay: run.localDay });
      await recomputeLadder(tx, run.profileId, run.listId, input.now);
    }
    await refreshVisibility(tx, run.profileId, challengeDay(input.now.getTime()), input.now);
    await resolveOpenReports(tx, eq(reports.resultId, run.id), 'upheld', input, 'void');
    await audit(tx, input, 'void', run.profileId, { resultId: run.id });
    return true;
  });
}

/** Visible to the person, with export and delete still working. Results stay in their history; only public surfaces change. */
export async function banProfile(db: Db, input: AdminInput & { profileId: number }): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(profiles)
      .set({ bannedAt: input.now })
      .where(eq(profiles.id, input.profileId))
      .returning({ id: profiles.id });
    if (!row) return false;
    await refreshVisibility(tx, row.id, challengeDay(input.now.getTime()), input.now);
    await resolveOpenReports(tx, eq(reports.subjectId, row.id), 'upheld', input, 'ban');
    await audit(tx, input, 'ban', row.id);
    return true;
  });
}

const RENAME_ATTEMPTS = 8;

/** Replaces the name with typist-48213, which the person can then change. The old name goes on the usual 30-day hold. */
export async function forceRename(db: Db, input: AdminInput & { profileId: number }): Promise<string | null> {
  const [profile] = await db.select().from(profiles).where(eq(profiles.id, input.profileId)).limit(1);
  if (!profile || profile.username === null) return null;
  const current: Pick<Profile, 'id' | 'username'> = profile;
  for (let attempt = 0; attempt < RENAME_ATTEMPTS; attempt++) {
    const username = `typist-${10000 + Math.floor(Math.random() * 90000)}`;
    try {
      await db.transaction(async (tx) => {
        await applyUsername(tx, current, username, input.now);
        await resolveOpenReports(tx, and(eq(reports.subjectId, profile.id), eq(reports.target, 'username')), 'upheld', input, 'rename');
        await audit(tx, input, 'rename', profile.id);
      });
      return username;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  return null;
}

/**
 * Once a day, by cron. Every statement converges, so a late, skipped or repeated run breaks nothing: the board rolls by key
 * and there is no destructive reset.
 */
export async function runDailyJob(db: Db, now: Date): Promise<void> {
  const today = challengeDay(now.getTime());
  const days = await rowsOf<{ day: string }>(
    db,
    sql`
      SELECT DISTINCT challenge_day::text AS day FROM daily_entries
      WHERE challenge_day < ${today}::date AND challenge_day >= ${today}::date - ${FINAL_RANK_LOOKBACK_DAYS}::int
    `,
  );
  for (const { day } of days) await refreshFinalRanks(db, day);

  // Only windows that lost a run: every other Pace is unchanged, and this keeps the job cheap as the ladder grows.
  const aged = await rowsOf<{ profile_id: number; list_id: number }>(
    db,
    sql`
      SELECT profile_id::int, list_id::int FROM ladder
      WHERE oldest_in_window_at <= ${at(now)} - interval '90 days'
    `,
  );
  for (const row of aged) await recomputeLadder(db, row.profile_id, row.list_id, now);
  await db.execute(sql`UPDATE ladder SET eligible = false WHERE eligible AND last_ranked_at <= ${at(now)} - interval '30 days'`);

  await db.execute(sql`DELETE FROM replays WHERE purge_after <= ${at(now)}`);
  await db.execute(sql`DELETE FROM key_stats WHERE week_start < (${at(now)})::date - ${KEY_STATS_KEEP_DAYS}::int`);
  await db.execute(sql`DELETE FROM username_holds WHERE release_at <= ${at(now)}`);
  await db.execute(sql`DELETE FROM rate_counters WHERE window_start <= ${at(now)} - make_interval(days => ${COUNTERS_KEEP_DAYS})`);
  await db.execute(sql`DELETE FROM reports WHERE resolved_at <= ${at(now)} - make_interval(days => ${REPORTS_KEEP_DAYS})`);
}
