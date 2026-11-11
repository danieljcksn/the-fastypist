import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { type Db, rowsOf } from "@/db/client";
import { read, type Read } from "@/db/read";
import { challengeDay, msUntilNextDay } from "@/engine/day";
import type { Language } from "@/engine/packs";
import { BOARDS_TAG, PROFILES_TAG } from "@/server/cache-tags";
import { type BoardRow, type StandingRow, publicProfile, publicResult, rankedListId, standings, todayBoard } from "@/server/ranking";
import { PACE_WINDOW_DAYS } from "@/server/standing";
import { type PacePoint, paceHistory } from "./pace-history";

// The strip draws every player, but past this many it is density, and the query stays bounded.
const STRIP_MAX = 2_000;
const HOUR_S = 3_600;
const FIVE_MIN_S = 300;

/**
 * An outage is cached for a minute at most, so a deploy built without a database, or a page rendered while it was down,
 * corrects itself on the next visit after that. Expire stays at five minutes: anything shorter would make the page dynamic.
 */
function unavailableLife(): void {
  cacheLife({ stale: 30, revalidate: 60, expire: FIVE_MIN_S });
}

export interface TodayBoard {
  day: string;
  total: number;
  rows: BoardRow[];
  /** Every visible speed on the board, in wpm, for the strip. */
  speeds: number[];
  standings: { shown: boolean; rows: StandingRow[] };
}

async function loadToday(db: Db, day: string, language: Language): Promise<TodayBoard> {
  const listId = rankedListId(language);
  const board = await todayBoard(db, { day, listId });
  const speeds = await rowsOf<{ wpm_cx: number }>(
    db,
    sql`SELECT wpm_cx::int FROM daily_entries WHERE challenge_day = ${day}::date AND list_id = ${listId} AND visible LIMIT ${STRIP_MAX}`,
  );
  const ladder = await standings(db, { listId });
  return {
    day,
    total: board.total,
    rows: board.rows,
    speeds: speeds.map((r) => r.wpm_cx / 100),
    standings: { shown: ladder.shown, rows: ladder.rows },
  };
}

/**
 * Revalidated by tag from every write that can move a board, and otherwise hourly. Near the turn of the day the lifetime
 * shortens to reach it, but never under five minutes, so no timer keeps the database awake.
 */
export async function todayRead(language: Language): Promise<Read<TodayBoard>> {
  "use cache";
  cacheTag(BOARDS_TAG);
  const now = Date.now();
  const day = challengeDay(now);
  const result = await read((db) => loadToday(db, day, language));
  if (result.state === "unavailable") unavailableLife();
  else cacheLife({ stale: FIVE_MIN_S, revalidate: Math.max(FIVE_MIN_S, Math.min(HOUR_S, Math.ceil(msUntilNextDay(now) / 1000))), expire: 86_400 });
  return result;
}

export type ProfileData = NonNullable<Awaited<ReturnType<typeof publicProfile>>> & {
  history: Partial<Record<Language, PacePoint[]>>;
};

async function loadProfile(db: Db, username: string, now: number): Promise<ProfileData | null> {
  const profile = await publicProfile(db, username);
  if (!profile) return null;
  const since = new Date(now - PACE_WINDOW_DAYS * 86_400_000).toISOString();
  const rows = await rowsOf<{ list_id: number; t: string; wpm_cx: number }>(
    db,
    sql`
      SELECT r.list_id::int, (extract(epoch FROM r.finished_at) * 1000)::bigint::text AS t, r.wpm_cx::int
      FROM results r JOIN profiles p ON p.id = r.profile_id
      WHERE p.username = ${profile.username} AND r.ranked AND r.finished_at >= ${since}::timestamptz
      ORDER BY r.finished_at
    `,
  );
  const history: Partial<Record<Language, PacePoint[]>> = {};
  for (const language of ["en", "pt"] as const) {
    const listId = rankedListId(language);
    const runs = rows.filter((r) => r.list_id === listId).map((r) => ({ t: Number(r.t), wpmCx: r.wpm_cx }));
    const points = paceHistory(runs);
    if (points.length > 0) history[language] = points;
  }
  return { ...profile, history };
}

/** Null is a real answer and is cached like any other: a profile that becomes listed revalidates the tag. */
export async function profileRead(username: string): Promise<Read<ProfileData | null>> {
  "use cache";
  cacheTag(PROFILES_TAG);
  const result = await read((db) => loadProfile(db, username, Date.now()));
  if (result.state === "unavailable") unavailableLife();
  else cacheLife("hours");
  return result;
}

/** A result never changes once written. Voiding it, banning or unlisting its typist revalidates the tags. */
export async function resultRead(id: string): Promise<Read<Awaited<ReturnType<typeof publicResult>>>> {
  "use cache";
  cacheTag(PROFILES_TAG, BOARDS_TAG);
  const result = await read((db) => publicResult(db, id));
  if (result.state === "unavailable") unavailableLife();
  else cacheLife("days");
  return result;
}
