import { type SQL, sql } from 'drizzle-orm';
import { type Db, rowsOf } from '@/db/client';

export const PACE_WINDOW_RUNS = 25;
export const PACE_WINDOW_DAYS = 90;
export const PACE_LISTED_RUNS = 10;
export const STANDINGS_ACTIVE_DAYS = 30;

export const at = (date: Date): SQL => sql`${date.toISOString()}::timestamptz`;

const SHOWN_PUBLICLY = sql`p.username IS NOT NULL AND p.listed_at IS NOT NULL AND p.ranking_consent_at IS NOT NULL AND p.banned_at IS NULL`;

export interface PaceRow {
  paceCx: number;
  runs: number;
  eligible: boolean;
}

/**
 * percentile_cont(0.8) is the same computation as the engine's paceOf, which a test holds to the bit. Rounding is safe to
 * compare: 0.8·(n−1) has a fraction in fifths, so an integer difference can never land on the .5 where round() and
 * Math.round differ.
 */
export async function recomputeLadder(db: Db, profileId: number, listId: number, now: Date): Promise<PaceRow | null> {
  const rows = await rowsOf<{ pace_cx: number; runs_in_window: number; eligible: boolean }>(
    db,
    sql`
      WITH runs AS (
        SELECT wpm_cx, finished_at FROM results
        WHERE profile_id = ${profileId} AND list_id = ${listId} AND ranked
          AND finished_at > ${at(now)} - make_interval(days => ${PACE_WINDOW_DAYS})
        ORDER BY finished_at DESC NULLS FIRST, id DESC
        LIMIT ${PACE_WINDOW_RUNS}
      ), summary AS (
        SELECT round(percentile_cont(0.8) WITHIN GROUP (ORDER BY wpm_cx))::int AS pace,
               max(wpm_cx) AS best, count(*)::int AS n, max(finished_at) AS newest, min(finished_at) AS oldest
        FROM runs
      )
      INSERT INTO ladder (profile_id, list_id, pace_cx, best_cx, runs_in_window, last_ranked_at, oldest_in_window_at, eligible)
      SELECT p.id, ${listId}::smallint, s.pace, s.best, s.n, s.newest, s.oldest,
             s.n >= ${PACE_LISTED_RUNS} AND s.newest > ${at(now)} - make_interval(days => ${STANDINGS_ACTIVE_DAYS}) AND ${SHOWN_PUBLICLY}
      FROM summary s CROSS JOIN profiles p
      WHERE p.id = ${profileId} AND s.n > 0
      ON CONFLICT (profile_id, list_id) DO UPDATE SET
        pace_cx = excluded.pace_cx, best_cx = excluded.best_cx, runs_in_window = excluded.runs_in_window,
        last_ranked_at = excluded.last_ranked_at, oldest_in_window_at = excluded.oldest_in_window_at, eligible = excluded.eligible
      RETURNING pace_cx::int, runs_in_window::int, eligible
    `,
  );
  const row = rows[0];
  if (row === undefined) {
    await db.execute(sql`DELETE FROM ladder WHERE profile_id = ${profileId} AND list_id = ${listId}`);
    return null;
  }
  return { paceCx: row.pace_cx, runs: row.runs_in_window, eligible: row.eligible };
}

export interface BestKey {
  profileId: number;
  listId: number;
  mode: 'time' | 'words';
  amount: number;
}

export interface BestReport {
  isNew: boolean;
  previousCx: number | null;
}

/** One statement, so that two concurrent runs can't both report the moment. WPM first, accuracy breaks a tie. */
export async function offerBest(
  db: Db,
  key: BestKey,
  run: { wpmCx: number; accuracyBp: number; resultId: string; at: Date },
): Promise<BestReport> {
  const rows = await rowsOf<{ previous: number | null; is_new: boolean }>(
    db,
    sql`
      WITH previous AS (
        SELECT wpm_cx FROM personal_bests
        WHERE profile_id = ${key.profileId} AND list_id = ${key.listId} AND mode = ${key.mode}::run_mode AND amount = ${key.amount}
      ), written AS (
        INSERT INTO personal_bests AS pb (profile_id, list_id, mode, amount, wpm_cx, accuracy_bp, result_id, achieved_at)
        VALUES (${key.profileId}, ${key.listId}, ${key.mode}::run_mode, ${key.amount}, ${run.wpmCx}, ${run.accuracyBp}, ${run.resultId}::uuid, ${at(run.at)})
        ON CONFLICT (profile_id, list_id, mode, amount) DO UPDATE SET
          wpm_cx = excluded.wpm_cx, accuracy_bp = excluded.accuracy_bp, result_id = excluded.result_id, achieved_at = excluded.achieved_at
        WHERE (excluded.wpm_cx, excluded.accuracy_bp) > (pb.wpm_cx, pb.accuracy_bp)
        RETURNING 1
      )
      SELECT (SELECT wpm_cx::int FROM previous) AS previous, EXISTS (SELECT 1 FROM written) AS is_new
    `,
  );
  return { isNew: rows[0]?.is_new ?? false, previousCx: rows[0]?.previous ?? null };
}

/** After a void or a release: rebuilt from the runs that still stand. */
export async function recomputeBest(db: Db, key: BestKey): Promise<void> {
  const matches = sql`profile_id = ${key.profileId} AND list_id = ${key.listId} AND mode = ${key.mode}::run_mode AND amount = ${key.amount}`;
  await db.execute(sql`DELETE FROM personal_bests WHERE ${matches}`);
  await db.execute(sql`
    INSERT INTO personal_bests (profile_id, list_id, mode, amount, wpm_cx, accuracy_bp, result_id, achieved_at)
    SELECT profile_id, list_id, mode, amount, wpm_cx, accuracy_bp, id, finished_at FROM results
    WHERE ${matches} AND status = 'passed' AND kind <> 'import'
    ORDER BY wpm_cx DESC, accuracy_bp DESC, finished_at
    LIMIT 1
  `);
}

export async function addToRollup(
  db: Db,
  key: BestKey & { localDay: string },
  run: { wpmCx: number; accuracyBp: number; elapsedMs: number },
): Promise<void> {
  await db.execute(sql`
    INSERT INTO daily_rollups AS r (profile_id, local_day, list_id, mode, amount, runs, ms_typed, wpm_sum_cx, acc_sum_bp, best_wpm_cx)
    VALUES (${key.profileId}, ${key.localDay}::date, ${key.listId}, ${key.mode}::run_mode, ${key.amount}, 1, ${run.elapsedMs}, ${run.wpmCx}, ${run.accuracyBp}, ${run.wpmCx})
    ON CONFLICT (profile_id, local_day, list_id, mode, amount) DO UPDATE SET
      runs = r.runs + 1, ms_typed = r.ms_typed + excluded.ms_typed, wpm_sum_cx = r.wpm_sum_cx + excluded.wpm_sum_cx,
      acc_sum_bp = r.acc_sum_bp + excluded.acc_sum_bp, best_wpm_cx = greatest(r.best_wpm_cx, excluded.best_wpm_cx)
  `);
}

export async function recomputeRollup(db: Db, key: BestKey & { localDay: string }): Promise<void> {
  const matches = sql`profile_id = ${key.profileId} AND local_day = ${key.localDay}::date AND list_id = ${key.listId} AND mode = ${key.mode}::run_mode AND amount = ${key.amount}`;
  await db.execute(sql`DELETE FROM daily_rollups WHERE ${matches}`);
  await db.execute(sql`
    INSERT INTO daily_rollups (profile_id, local_day, list_id, mode, amount, runs, ms_typed, wpm_sum_cx, acc_sum_bp, best_wpm_cx)
    SELECT profile_id, local_day, list_id, mode, amount, count(*), sum(elapsed_ms), sum(wpm_cx), sum(accuracy_bp), max(wpm_cx) FROM results
    WHERE ${matches} AND status <> 'voided' AND kind <> 'import'
    GROUP BY profile_id, local_day, list_id, mode, amount
  `);
}

/** Idempotent. Late outbox arrivals and voids can change a finished day, so this may run on any day any number of times. */
export async function refreshFinalRanks(db: Db, day: string): Promise<void> {
  await db.execute(sql`
    UPDATE daily_entries d SET final_rank = r.place
    FROM (
      SELECT list_id, profile_id, rank() OVER (PARTITION BY list_id ORDER BY wpm_cx DESC, accuracy_bp DESC)::int AS place
      FROM daily_entries WHERE challenge_day = ${day}::date AND visible
    ) r
    WHERE d.challenge_day = ${day}::date AND d.list_id = r.list_id AND d.profile_id = r.profile_id
      AND d.final_rank IS DISTINCT FROM r.place
  `);
  await db.execute(sql`
    UPDATE daily_entries SET final_rank = NULL
    WHERE challenge_day = ${day}::date AND NOT visible AND final_rank IS NOT NULL
  `);
}

/** After consent, listing, a ban, a release or a void. Past days' ranks follow; today's has no final rank yet. */
export async function refreshVisibility(db: Db, profileId: number, today: string, now: Date): Promise<void> {
  const changed = await rowsOf<{ challenge_day: string }>(
    db,
    sql`
      WITH wanted AS (
        SELECT d.challenge_day, d.list_id, d.profile_id,
               coalesce((SELECT r.ranked FROM results r WHERE r.id = d.result_id), false)
                 AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = d.profile_id AND ${SHOWN_PUBLICLY}) AS show
        FROM daily_entries d WHERE d.profile_id = ${profileId}
      )
      UPDATE daily_entries d SET visible = w.show
      FROM wanted w
      WHERE d.challenge_day = w.challenge_day AND d.list_id = w.list_id AND d.profile_id = w.profile_id AND d.visible <> w.show
      RETURNING d.challenge_day::text AS challenge_day
    `,
  );
  const days = new Set(changed.map((row) => row.challenge_day));
  for (const day of days) if (day < today) await refreshFinalRanks(db, day);
  await db.execute(sql`
    UPDATE ladder l SET eligible = l.runs_in_window >= ${PACE_LISTED_RUNS}
      AND l.last_ranked_at > ${at(now)} - make_interval(days => ${STANDINGS_ACTIVE_DAYS})
      AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = l.profile_id AND ${SHOWN_PUBLICLY})
    WHERE l.profile_id = ${profileId}
  `);
}
