import { createHmac } from 'node:crypto';
import { type SQL, and, desc, eq, gte, sql } from 'drizzle-orm';
import { type Db, rowsOf } from '@/db/client';
import { LIST_IDS } from '@/db/lists';
import { dailyChallenges, dailyEntries, keyStats, ladder, personalBests, profiles, replays, results, wordLists } from '@/db/schema';
import { challengeDay } from '@/engine/day';
import { RANKED_PACK, type Language } from '@/engine/packs';
import { MAX_CX } from '@/engine/score';
import { type Profile, ensureProfile, findProfile } from './accounts';
import { isDay, isUuid, pageNumber } from './input';
import { countKeys, decodeCounts, mergeCounts, weekStartOf } from './keystats';
import { checkStanding, needsBoardRank, plausibilityConfig } from './plausibility';
import {
  type BestKey,
  type BestReport,
  PACE_LISTED_RUNS,
  type PaceRow,
  addToRollup,
  at,
  hitCounter,
  offerBest,
  recomputeBest,
  recomputeLadder,
  refreshFinalRanks,
  refreshVisibility,
} from './standing';
import { type IssuedTicket, TicketConfigError, issueTicket } from './tickets';
import { USERNAME_FORMAT, normalizeUsername } from './username';
import {
  type Rejection,
  type VerifiedRun,
  RANKED_SECONDS,
  failedGates,
  flightLog,
  judgeRetry,
  prepareSubmission,
  verifyRun,
} from './verify';

export const STANDINGS_MIN_TYPISTS = 20;
export const BOARD_PAGE_SIZE = 50;
export const PLACED_MIN_PLAYERS = 5;
const RETAINED_TOP = 10;
const REPLAY_RETENTION_MS = 30 * 86_400_000;
const SUBMITS_PER_HOUR = 240;
const CONFIRM_PERCENT = 85;

export function rankedListId(language: Language): number {
  return LIST_IDS[RANKED_PACK[language]];
}

export interface RunSummary {
  id: string;
  kind: 'free' | 'daily' | 'import';
  status: 'passed' | 'held' | 'voided' | 'unverified';
  ranked: boolean;
  mode: 'time' | 'words';
  amount: number;
  wpmCx: number;
  rawCx: number;
  accuracyBp: number;
  consistencyBp: number | null;
  finishedAt: Date;
}

export type SubmitOutcome =
  | { status: 'rejected'; reason: Rejection | 'nonce-used' | 'attempt-mismatch' }
  | { status: 'rate-limited' }
  | {
      status: 'recorded';
      retried: boolean;
      result: RunSummary;
      personalBest: BestReport | null;
      pace: (PaceRow & { listed: boolean }) | null;
      today: { rank: number; total: number } | null;
      /** The held run this one released, when it was a retype. */
      released: string | null;
    };

class Abort extends Error {
  constructor(readonly outcome: Extract<SubmitOutcome, { status: 'rejected' | 'rate-limited' }>) {
    super(outcome.status);
  }
}

class LostRace extends Error {}

const summaryColumns = {
  id: results.id,
  kind: results.kind,
  status: results.status,
  ranked: results.ranked,
  mode: results.mode,
  amount: results.amount,
  wpmCx: results.wpmCx,
  rawCx: results.rawCx,
  accuracyBp: results.accuracyBp,
  consistencyBp: results.consistencyBp,
  finishedAt: results.finishedAt,
};

async function storedOutcome(db: Db, id: string, profileId: number): Promise<SubmitOutcome> {
  const [row] = await db
    .select({
      ...summaryColumns,
      listId: results.listId,
      challengeDay: results.challengeDay,
      newBest: results.newBest,
      previousBestCx: results.previousBestCx,
    })
    .from(results)
    .where(eq(results.id, id))
    .limit(1);
  if (!row) throw new Error('stored result vanished');
  const { listId, challengeDay: day, newBest, previousBestCx, ...summary } = row;
  const [paceRow] =
    listId === null
      ? []
      : await db
          .select()
          .from(ladder)
          .where(and(eq(ladder.profileId, profileId), eq(ladder.listId, listId)));
  return {
    status: 'recorded',
    retried: true,
    result: summary,
    personalBest: summary.status === 'passed' ? { isNew: newBest, previousCx: previousBestCx } : null,
    pace: paceRow
      ? { paceCx: paceRow.paceCx, runs: paceRow.runsInWindow, eligible: paceRow.eligible, listed: paceRow.runsInWindow >= PACE_LISTED_RUNS }
      : null,
    today: day !== null && listId !== null ? await placeOf(db, day, listId, summary.wpmCx, summary.accuracyBp) : null,
    released: null,
  };
}

/** Where a score lands on a day's board, whether or not it is on the board itself. */
export async function placeOf(
  db: Db,
  day: string,
  listId: number,
  wpmCx: number,
  accuracyBp: number,
): Promise<{ rank: number; total: number }> {
  const [row] = await rowsOf<{ rank: number; total: number }>(
    db,
    sql`
      SELECT 1 + (count(*) FILTER (WHERE (wpm_cx, accuracy_bp) > (${wpmCx}::int, ${accuracyBp}::int)))::int AS rank, count(*)::int AS total
      FROM daily_entries
      WHERE challenge_day = ${day}::date AND list_id = ${listId} AND visible
    `,
  );
  return { rank: row?.rank ?? 1, total: row?.total ?? 0 };
}

async function standingsPlaceOf(db: Db, listId: number, paceCx: number): Promise<{ rank: number; total: number }> {
  const [row] = await rowsOf<{ rank: number; total: number }>(
    db,
    sql`
      SELECT 1 + (count(*) FILTER (WHERE pace_cx > ${paceCx}::int))::int AS rank, count(*)::int AS total
      FROM ladder WHERE list_id = ${listId} AND eligible
    `,
  );
  return { rank: row?.rank ?? 1, total: row?.total ?? 0 };
}

/** Takes the raw body and the Clerk user id. Rejection covers integrity failures only: every other doubt becomes a status. */
export async function submitRun(db: Db, input: { clerkUserId: string; body: Uint8Array; now: number }): Promise<SubmitOutcome> {
  const prepared = prepareSubmission(input.body);
  if (!prepared.ok) return { status: 'rejected', reason: prepared.reason };
  const { ticket, bodyHash } = prepared.prepared;
  const profile = await ensureProfile(db, input.clerkUserId);

  const answerStored = async (stored: { profileId: number; bodyHash: Buffer | null }): Promise<SubmitOutcome> =>
    judgeRetry(stored, profile.id, bodyHash) === 'same'
      ? storedOutcome(db, ticket.nonce, profile.id)
      : { status: 'rejected', reason: 'nonce-used' };
  const readStored = async () => {
    const [row] = await db
      .select({ profileId: results.profileId, bodyHash: results.bodyHash })
      .from(results)
      .where(eq(results.id, ticket.nonce))
      .limit(1);
    return row;
  };

  const before = await readStored();
  if (before) return answerStored(before);

  const plausibility = plausibilityConfig();
  const verified = verifyRun(prepared.prepared, input.now, plausibility);
  if (!verified.ok) return { status: 'rejected', reason: verified.reason };

  try {
    return await db.transaction((tx) => recordRun(tx, verified.run, profile, new Date(input.now)));
  } catch (error) {
    if (error instanceof Abort) return error.outcome;
    if (error instanceof LostRace) {
      const after = await readStored();
      if (after) return answerStored(after);
    }
    throw error;
  }
}

async function recordRun(tx: Db, run: VerifiedRun, profile: Profile, now: Date): Promise<SubmitOutcome> {
  const { ticket, score } = run;
  const plausibility = plausibilityConfig();
  const listId = LIST_IDS[ticket.pack];
  const hour = new Date(now.getTime() - (now.getTime() % 3_600_000));
  if ((await hitCounter(tx, profile.id, 'submit', hour)) > SUBMITS_PER_HOUR) throw new Abort({ status: 'rate-limited' });

  if (ticket.day !== undefined) {
    const [entry] = await tx
      .select()
      .from(dailyEntries)
      .where(and(eq(dailyEntries.challengeDay, ticket.day), eq(dailyEntries.listId, listId), eq(dailyEntries.profileId, profile.id)))
      .for('update');
    if (!entry || entry.ticketNonce !== ticket.nonce) throw new Abort({ status: 'rejected', reason: 'attempt-mismatch' });
  }

  const [prior] = await tx
    .select()
    .from(ladder)
    .where(and(eq(ladder.profileId, profile.id), eq(ladder.listId, listId)));
  const board = !needsBoardRank(score.wpmCx, plausibility)
    ? null
    : ticket.day !== undefined
      ? await placeOf(tx, ticket.day, listId, score.wpmCx, score.accuracyBp)
      : await standingsPlaceOf(tx, listId, score.wpmCx);
  const standing = checkStanding(
    {
      wpmCx: score.wpmCx,
      daily: ticket.day !== undefined,
      paceCx: prior?.paceCx ?? null,
      runsInWindow: prior?.runsInWindow ?? 0,
      bestCx: prior?.bestCx ?? null,
      board,
    },
    plausibility,
  );
  const status = standing.length > 0 ? 'held' : run.status;
  const reasons = [...standing, ...run.reasons];
  // Judged on the timing, not the status: a hold can sit on top of a downgrade, and a release must not launder it.
  const rankable = failedGates(run, profile).length === 0 && !run.downgraded;
  const ranked = rankable && status === 'passed';
  const finishedAt = new Date(run.finishedAtMs);
  const key: BestKey = { profileId: profile.id, listId, mode: ticket.mode, amount: ticket.amount };

  const inserted = await tx
    .insert(results)
    .values({
      id: ticket.nonce,
      profileId: profile.id,
      listId,
      kind: ticket.day !== undefined ? 'daily' : 'free',
      status,
      ranked,
      rankable,
      mode: ticket.mode,
      amount: ticket.amount,
      wpmCx: score.wpmCx,
      rawCx: score.rawCx,
      accuracyBp: score.accuracyBp,
      consistencyBp: run.consistencyBp,
      elapsedMs: score.elapsedMs,
      seed: Buffer.from(ticket.seed, 'hex'),
      scorerVersion: ticket.scorer,
      bodyHash: run.bodyHash,
      device: run.device,
      challengeDay: ticket.day ?? null,
      localDay: run.localDay,
      finishedAt,
      wpmSeries: run.series,
      holdReasons: reasons.length > 0 ? reasons : null,
    })
    .onConflictDoNothing({ target: results.id })
    .returning({ id: results.id });
  // A concurrent retry won the primary key. Rolling back undoes the rate counter too, and the caller answers from its row.
  if (inserted.length === 0) throw new LostRace();

  let personalBest: BestReport | null = null;
  if (status === 'passed') {
    personalBest = await offerBest(tx, key, { wpmCx: score.wpmCx, accuracyBp: score.accuracyBp, resultId: ticket.nonce, at: finishedAt });
    if (personalBest.isNew || personalBest.previousCx !== null) {
      await tx
        .update(results)
        .set({ newBest: personalBest.isNew, previousBestCx: personalBest.previousCx })
        .where(eq(results.id, ticket.nonce));
    }
  }

  await addToRollup(
    tx,
    { ...key, localDay: run.localDay },
    { wpmCx: score.wpmCx, accuracyBp: score.accuracyBp, elapsedMs: score.elapsedMs },
  );
  await addKeyStats(tx, run, profile.id, listId);

  const pace = ranked ? await recomputeLadder(tx, profile.id, listId, now) : null;

  let today: { rank: number; total: number } | null = null;
  if (ticket.day !== undefined) {
    const visible = ranked && profile.listedAt !== null && profile.bannedAt === null;
    await tx
      .update(dailyEntries)
      .set({ resultId: ticket.nonce, wpmCx: score.wpmCx, accuracyBp: score.accuracyBp, finishedAt, visible })
      .where(and(eq(dailyEntries.challengeDay, ticket.day), eq(dailyEntries.listId, listId), eq(dailyEntries.profileId, profile.id)));
    today = await placeOf(tx, ticket.day, listId, score.wpmCx, score.accuracyBp);
    if (ticket.day < challengeDay(now.getTime())) await refreshFinalRanks(tx, ticket.day);
    if (visible && today.rank <= RETAINED_TOP) await keepFlightTimes(tx, run, profile, now);
  }
  if (status === 'held') await keepFlightTimes(tx, run, profile, now);

  const released = run.confirms !== null && status === 'passed' ? await releaseByRetype(tx, run, run.confirms, profile.id, now) : null;

  return {
    status: 'recorded',
    retried: false,
    result: {
      id: ticket.nonce,
      kind: ticket.day !== undefined ? 'daily' : 'free',
      status,
      ranked,
      mode: ticket.mode,
      amount: ticket.amount,
      wpmCx: score.wpmCx,
      rawCx: score.rawCx,
      accuracyBp: score.accuracyBp,
      consistencyBp: run.consistencyBp,
      finishedAt,
    },
    personalBest,
    pace: pace ? { ...pace, listed: pace.runs >= PACE_LISTED_RUNS } : null,
    today,
    released,
  };
}

/** Only with ranking consent, which is what the disclosure of this retention is attached to. */
async function keepFlightTimes(tx: Db, run: VerifiedRun, profile: Profile, now: Date): Promise<void> {
  if (profile.rankingConsentAt === null) return;
  await tx
    .insert(replays)
    .values({
      resultId: run.ticket.nonce,
      profileId: profile.id,
      log: flightLog(run.entries),
      purgeAfter: new Date(now.getTime() + REPLAY_RETENTION_MS),
    })
    .onConflictDoNothing();
}

async function addKeyStats(tx: Db, run: VerifiedRun, profileId: number, listId: number): Promise<void> {
  const counts = countKeys(run.config, run.words, run.entries, run.ticket.language);
  const weekStart = weekStartOf(run.localDay);
  const inserted = await tx
    .insert(keyStats)
    .values({ profileId, listId, weekStart, counts })
    .onConflictDoNothing()
    .returning({ profileId: keyStats.profileId });
  if (inserted.length > 0) return;
  const where = and(eq(keyStats.profileId, profileId), eq(keyStats.listId, listId), eq(keyStats.weekStart, weekStart));
  const [row] = await tx.select({ counts: keyStats.counts }).from(keyStats).where(where).for('update');
  if (row)
    await tx
      .update(keyStats)
      .set({ counts: mergeCounts(row.counts, counts) })
      .where(where);
}

/** After a held run stops being held: it may now rank, so everything derived from ranked runs is rebuilt. */
export async function applyRelease(
  tx: Db,
  row: { id: string; profileId: number; listId: number | null; mode: 'time' | 'words'; amount: number },
  now: Date,
): Promise<void> {
  if (row.listId === null) return;
  await recomputeBest(tx, { profileId: row.profileId, listId: row.listId, mode: row.mode, amount: row.amount });
  await recomputeLadder(tx, row.profileId, row.listId, now);
  await refreshVisibility(tx, row.profileId, challengeDay(now.getTime()), now);
}

/** A fresh run at 85% of the held speed clears a false positive cheaply. A bot passes too, which is why review stays. */
async function releaseByRetype(tx: Db, run: VerifiedRun, heldId: string, profileId: number, now: Date): Promise<string | null> {
  const [held] = await tx
    .select()
    .from(results)
    .where(
      and(
        eq(results.id, heldId),
        eq(results.profileId, profileId),
        eq(results.status, 'held'),
        eq(results.listId, LIST_IDS[run.ticket.pack]),
        eq(results.mode, run.ticket.mode),
        eq(results.amount, run.ticket.amount),
      ),
    )
    .for('update');
  if (!held || held.finishedAt.getTime() >= run.finishedAtMs || run.score.wpmCx * 100 < held.wpmCx * CONFIRM_PERCENT) return null;
  await tx.update(results).set({ status: 'passed', ranked: held.rankable, confirmedBy: run.ticket.nonce }).where(eq(results.id, heldId));
  await applyRelease(tx, held, now);
  return heldId;
}

function dailySecret(): string {
  const secret = process.env.DAILY_SECRET;
  if (secret === undefined || secret.length < 32) throw new TicketConfigError('DAILY_SECRET must be at least 32 characters');
  return secret;
}

/** Secret until reveal: a date-derived seed in the client bundle would leak every future text. */
export function deriveDailySeed(day: string, listId: number): string {
  return createHmac('sha256', dailySecret()).update(`${day}|${listId}`).digest('hex').slice(0, 32);
}

export type RevealOutcome =
  | { status: 'revealed'; day: string; issued: IssuedTicket }
  | { status: 'spent'; day: string; finished: boolean }
  | { status: 'not-eligible'; missing: string[] };

/** The insert that spends the attempt. The seed leaves this function only when that insert took the row. */
export async function revealToday(db: Db, input: { clerkUserId: string; language: Language; now: number }): Promise<RevealOutcome> {
  const profile = await ensureProfile(db, input.clerkUserId);
  const missing = [
    ...(profile.username === null ? ['username'] : []),
    ...(profile.rankingConsentAt === null ? ['consent'] : []),
    ...(profile.bannedAt !== null ? ['banned'] : []),
  ];
  if (missing.length > 0) return { status: 'not-eligible', missing };

  const day = challengeDay(input.now);
  const pack = RANKED_PACK[input.language];
  const listId = LIST_IDS[pack];
  const nonce = crypto.randomUUID();
  const derived = deriveDailySeed(day, listId);

  return db.transaction(async (tx) => {
    const taken = await tx
      .insert(dailyEntries)
      .values({ challengeDay: day, listId, profileId: profile.id, ticketNonce: nonce, startedAt: new Date(input.now) })
      .onConflictDoNothing()
      .returning({ nonce: dailyEntries.ticketNonce });
    if (taken.length === 0) {
      const [entry] = await tx
        .select({ resultId: dailyEntries.resultId })
        .from(dailyEntries)
        .where(and(eq(dailyEntries.challengeDay, day), eq(dailyEntries.listId, listId), eq(dailyEntries.profileId, profile.id)));
      return { status: 'spent', day, finished: entry?.resultId !== null };
    }
    await tx
      .insert(dailyChallenges)
      .values({ challengeDay: day, listId, seed: Buffer.from(derived, 'hex') })
      .onConflictDoNothing();
    const [challenge] = await tx
      .select({ seed: dailyChallenges.seed })
      .from(dailyChallenges)
      .where(and(eq(dailyChallenges.challengeDay, day), eq(dailyChallenges.listId, listId)));
    const seed = challenge?.seed.toString('hex') ?? derived;
    return {
      status: 'revealed',
      day,
      issued: issueTicket({ language: input.language, pack, mode: 'time', amount: RANKED_SECONDS, seed, nonce, day }, input.now),
    };
  });
}

/** A finished day's seed, for guests. Null for today and later: a guest playing today's text would be free practice for it. */
export async function publicSeed(
  db: Db,
  input: { day: string; language: Language; now: number },
): Promise<{ seed: string; pack: string } | null> {
  if (!isDay(input.day) || input.day >= challengeDay(input.now)) return null;
  const pack = RANKED_PACK[input.language];
  const listId = LIST_IDS[pack];
  const [row] = await db
    .select({ seed: dailyChallenges.seed })
    .from(dailyChallenges)
    .where(and(eq(dailyChallenges.challengeDay, input.day), eq(dailyChallenges.listId, listId)));
  return { seed: row ? row.seed.toString('hex') : deriveDailySeed(input.day, listId), pack };
}

/** "You'd have placed 3rd of 41". The speed is the guest's own claim: it writes nothing and nobody else sees it. */
export async function wouldHavePlaced(
  db: Db,
  input: { day: string; language: Language; wpmCx: number; accuracyBp: number; now: number },
): Promise<{ rank: number; total: number } | null> {
  if (!isDay(input.day) || input.day >= challengeDay(input.now)) return null;
  const { wpmCx, accuracyBp } = input;
  if (!Number.isInteger(wpmCx) || wpmCx < 0 || wpmCx > MAX_CX || !Number.isInteger(accuracyBp) || accuracyBp < 0 || accuracyBp > 10_000) return null;
  const place = await placeOf(db, input.day, rankedListId(input.language), input.wpmCx, input.accuracyBp);
  return place.total >= PLACED_MIN_PLAYERS ? place : null;
}

export interface BoardRow {
  rank: number;
  username: string;
  wpmCx: number;
  accuracyBp: number;
}

/**
 * Exact ties share a rank, and the rank stays right on a page that starts midway through a tie. Rows tied with the page's
 * top score rank from a count of what is strictly ahead of it. Every other row has all earlier pages ahead of it, so it
 * ranks from the offset: rank() alone would miss the earlier rows of that tie.
 */
export async function todayBoard(
  db: Db,
  input: { day: string; listId: number; page?: number },
): Promise<{ total: number; rows: BoardRow[] }> {
  if (!isDay(input.day)) return { total: 0, rows: [] };
  const offset = pageNumber(input.page) * BOARD_PAGE_SIZE;
  const here = sql`challenge_day = ${input.day}::date AND list_id = ${input.listId} AND visible`;
  const [count] = await rowsOf<{ total: number }>(db, sql`SELECT count(*)::int AS total FROM daily_entries WHERE ${here}`);
  const rows = await rowsOf<{ rank: number; username: string; wpm_cx: number; accuracy_bp: number }>(
    db,
    sql`
      WITH page AS (
        SELECT profile_id, wpm_cx, accuracy_bp, finished_at FROM daily_entries
        WHERE ${here}
        ORDER BY wpm_cx DESC, accuracy_bp DESC, finished_at, profile_id
        LIMIT ${BOARD_PAGE_SIZE} OFFSET ${offset}
      ), top AS (
        SELECT wpm_cx, accuracy_bp FROM page ORDER BY wpm_cx DESC, accuracy_bp DESC LIMIT 1
      ), ahead AS (
        SELECT count(*)::int AS n FROM daily_entries e, top
        WHERE e.challenge_day = ${input.day}::date AND e.list_id = ${input.listId} AND e.visible
          AND (e.wpm_cx, e.accuracy_bp) > (top.wpm_cx, top.accuracy_bp)
      )
      SELECT (CASE WHEN (p.wpm_cx, p.accuracy_bp) = (top.wpm_cx, top.accuracy_bp) THEN ahead.n + 1
                   ELSE ${offset}::int + rank() OVER (ORDER BY p.wpm_cx DESC, p.accuracy_bp DESC) END)::int AS rank,
             u.username, p.wpm_cx::int, p.accuracy_bp::int
      FROM page p JOIN profiles u ON u.id = p.profile_id CROSS JOIN top CROSS JOIN ahead
      ORDER BY p.wpm_cx DESC, p.accuracy_bp DESC, p.finished_at, p.profile_id
    `,
  );
  return {
    total: count?.total ?? 0,
    rows: rows.map((r) => ({ rank: r.rank, username: r.username, wpmCx: r.wpm_cx, accuracyBp: r.accuracy_bp })),
  };
}

export interface YourPlace {
  rank: number;
  total: number;
  /** False when unlisted or held: "You'd be 14th". */
  onBoard: boolean;
  wpmCx: number;
  accuracyBp: number;
  above: BoardRow[];
  below: BoardRow[];
}

export async function yourToday(db: Db, input: { clerkUserId: string; day: string; listId: number }): Promise<YourPlace | null> {
  if (!isDay(input.day)) return null;
  const profile = await findProfile(db, input.clerkUserId);
  if (!profile) return null;
  const [entry] = await db
    .select()
    .from(dailyEntries)
    .where(and(eq(dailyEntries.challengeDay, input.day), eq(dailyEntries.listId, input.listId), eq(dailyEntries.profileId, profile.id)));
  if (!entry || entry.wpmCx === null || entry.accuracyBp === null || entry.finishedAt === null) return null;
  const { wpmCx, accuracyBp, finishedAt } = entry;
  const place = await placeOf(db, input.day, input.listId, wpmCx, accuracyBp);
  const here = sql`e.challenge_day = ${input.day}::date AND e.list_id = ${input.listId} AND e.visible`;
  const me = sql`(${wpmCx}::int, ${accuracyBp}::int)`;
  const tie = sql`(e.finished_at, e.profile_id) `;
  const mine = sql`(${at(finishedAt)}, ${profile.id}::bigint)`;
  const rankOf = sql`1 + (SELECT count(*)::int FROM daily_entries o WHERE o.challenge_day = ${input.day}::date AND o.list_id = ${input.listId} AND o.visible AND (o.wpm_cx, o.accuracy_bp) > (e.wpm_cx, e.accuracy_bp))`;
  const toRow = (r: { rank: number; username: string; wpm_cx: number; accuracy_bp: number }): BoardRow => ({
    rank: r.rank,
    username: r.username,
    wpmCx: r.wpm_cx,
    accuracyBp: r.accuracy_bp,
  });
  const above = await rowsOf<{ rank: number; username: string; wpm_cx: number; accuracy_bp: number }>(
    db,
    sql`
      SELECT (${rankOf})::int AS rank, u.username, e.wpm_cx::int, e.accuracy_bp::int
      FROM daily_entries e JOIN profiles u ON u.id = e.profile_id
      WHERE ${here} AND e.wpm_cx >= ${wpmCx}::int
        AND ((e.wpm_cx, e.accuracy_bp) > ${me} OR ((e.wpm_cx, e.accuracy_bp) = ${me} AND ${tie} < ${mine}))
      ORDER BY e.wpm_cx, e.accuracy_bp, e.finished_at DESC, e.profile_id DESC
      LIMIT 2
    `,
  );
  const below = await rowsOf<{ rank: number; username: string; wpm_cx: number; accuracy_bp: number }>(
    db,
    sql`
      SELECT (${rankOf})::int AS rank, u.username, e.wpm_cx::int, e.accuracy_bp::int
      FROM daily_entries e JOIN profiles u ON u.id = e.profile_id
      WHERE ${here} AND e.wpm_cx <= ${wpmCx}::int
        AND ((e.wpm_cx, e.accuracy_bp) < ${me} OR ((e.wpm_cx, e.accuracy_bp) = ${me} AND ${tie} > ${mine}))
      ORDER BY e.wpm_cx DESC, e.accuracy_bp DESC, e.finished_at, e.profile_id
      LIMIT 2
    `,
  );
  return { ...place, onBoard: entry.visible, wpmCx, accuracyBp, above: above.reverse().map(toRow), below: below.map(toRow) };
}

export interface StandingRow {
  rank: number;
  username: string;
  paceCx: number;
  bestCx: number;
  runs: number;
}

/** Hidden until 20 eligible typists exist on the list. `shown` is false until then and rows stay empty. */
export async function standings(
  db: Db,
  input: { listId: number; page?: number },
): Promise<{ shown: boolean; eligible: number; rows: StandingRow[] }> {
  const [count] = await rowsOf<{ n: number }>(db, sql`SELECT count(*)::int AS n FROM ladder WHERE list_id = ${input.listId} AND eligible`);
  const eligible = count?.n ?? 0;
  if (eligible < STANDINGS_MIN_TYPISTS) return { shown: false, eligible, rows: [] };
  const offset = pageNumber(input.page) * BOARD_PAGE_SIZE;
  const rows = await rowsOf<{ rank: number; username: string; pace_cx: number; best_cx: number; runs_in_window: number }>(
    db,
    sql`
      WITH page AS (
        SELECT profile_id, pace_cx, best_cx, runs_in_window FROM ladder
        WHERE list_id = ${input.listId} AND eligible
        ORDER BY pace_cx DESC, profile_id
        LIMIT ${BOARD_PAGE_SIZE} OFFSET ${offset}
      ), ahead AS (
        SELECT count(*)::int AS n, (SELECT max(pace_cx) FROM page) AS top FROM ladder l
        WHERE l.list_id = ${input.listId} AND l.eligible AND l.pace_cx > (SELECT max(pace_cx) FROM page)
      )
      SELECT (CASE WHEN p.pace_cx = ahead.top THEN ahead.n + 1 ELSE ${offset}::int + rank() OVER (ORDER BY p.pace_cx DESC) END)::int AS rank,
             u.username, p.pace_cx::int, p.best_cx::int, p.runs_in_window::int
      FROM page p JOIN profiles u ON u.id = p.profile_id CROSS JOIN ahead
      ORDER BY p.pace_cx DESC, p.profile_id
    `,
  );
  return {
    shown: true,
    eligible,
    rows: rows.map((r) => ({ rank: r.rank, username: r.username, paceCx: r.pace_cx, bestCx: r.best_cx, runs: r.runs_in_window })),
  };
}

export interface YourStanding {
  paceCx: number;
  runs: number;
  eligible: boolean;
  rank: number;
  total: number;
  above: StandingRow[];
  below: StandingRow[];
}

export async function yourStanding(db: Db, input: { clerkUserId: string; listId: number }): Promise<YourStanding | null> {
  const profile = await findProfile(db, input.clerkUserId);
  if (!profile) return null;
  const [row] = await db
    .select()
    .from(ladder)
    .where(and(eq(ladder.profileId, profile.id), eq(ladder.listId, input.listId)));
  if (!row) return null;
  const place = await standingsPlaceOf(db, input.listId, row.paceCx);
  const select = (where: SQL, order: SQL) =>
    rowsOf<{ rank: number; username: string; pace_cx: number; best_cx: number; runs_in_window: number }>(
      db,
      sql`
        SELECT (1 + (SELECT count(*)::int FROM ladder o WHERE o.list_id = ${input.listId} AND o.eligible AND o.pace_cx > l.pace_cx))::int AS rank,
               u.username, l.pace_cx::int, l.best_cx::int, l.runs_in_window::int
        FROM ladder l JOIN profiles u ON u.id = l.profile_id
        WHERE l.list_id = ${input.listId} AND l.eligible AND ${where}
        ORDER BY ${order}
        LIMIT 2
      `,
    );
  const above = await select(
    sql`(l.pace_cx > ${row.paceCx}::int OR (l.pace_cx = ${row.paceCx}::int AND l.profile_id < ${profile.id}::bigint))`,
    sql`l.pace_cx, l.profile_id DESC`,
  );
  const below = await select(
    sql`(l.pace_cx < ${row.paceCx}::int OR (l.pace_cx = ${row.paceCx}::int AND l.profile_id > ${profile.id}::bigint))`,
    sql`l.pace_cx DESC, l.profile_id`,
  );
  const toRow = (r: { rank: number; username: string; pace_cx: number; best_cx: number; runs_in_window: number }): StandingRow => ({
    rank: r.rank,
    username: r.username,
    paceCx: r.pace_cx,
    bestCx: r.best_cx,
    runs: r.runs_in_window,
  });
  return {
    paceCx: row.paceCx,
    runs: row.runsInWindow,
    eligible: row.eligible,
    ...place,
    above: above.reverse().map(toRow),
    below: below.map(toRow),
  };
}

export interface PublicProfile {
  username: string;
  joinedOn: string;
  rankedRuns: number;
  paces: { pack: string; paceCx: number; runs: number; listed: boolean }[];
  bests: { pack: string; mode: 'time' | 'words'; amount: number; wpmCx: number; accuracyBp: number; achievedOn: string }[];
  lastDays: { day: string; pack: string; wpmCx: number; accuracyBp: number; place: number | null }[];
}

const dateOf = (when: Date): string => when.toISOString().slice(0, 10);

const packOf = (listId: number): string => Object.entries(LIST_IDS).find(([, id]) => id === listId)?.[0] ?? '';

/** Listed profiles only: an unlisted or banned username reads as not found. Nothing about time of day or zone is in here. */
export async function publicProfile(db: Db, rawUsername: string): Promise<PublicProfile | null> {
  const username = normalizeUsername(rawUsername);
  if (!USERNAME_FORMAT.test(username)) return null;
  const [profile] = await db.select().from(profiles).where(eq(profiles.username, username)).limit(1);
  if (!profile || profile.listedAt === null || profile.bannedAt !== null || profile.username === null) return null;
  const id = profile.id;
  const [count] = await rowsOf<{ n: number }>(db, sql`SELECT count(*)::int AS n FROM results WHERE profile_id = ${id} AND ranked`);
  const paces = await db.select().from(ladder).where(eq(ladder.profileId, id));
  const bests = await rowsOf<{
    list_id: number;
    mode: 'time' | 'words';
    amount: number;
    wpm_cx: number;
    accuracy_bp: number;
    achieved_at: string;
  }>(
    db,
    sql`
      SELECT b.list_id::int, b.mode, b.amount::int, b.wpm_cx::int, b.accuracy_bp::int, to_json(b.achieved_at)#>>'{}' AS achieved_at
      FROM personal_bests b JOIN results r ON r.id = b.result_id
      WHERE b.profile_id = ${id} AND r.ranked
    `,
  );
  const days = await db
    .select()
    .from(dailyEntries)
    .where(and(eq(dailyEntries.profileId, id), eq(dailyEntries.visible, true)))
    .orderBy(desc(dailyEntries.challengeDay))
    .limit(5);
  return {
    username: profile.username,
    joinedOn: dateOf(profile.createdAt),
    rankedRuns: count?.n ?? 0,
    paces: paces.map((p) => ({
      pack: packOf(p.listId),
      paceCx: p.paceCx,
      runs: p.runsInWindow,
      listed: p.runsInWindow >= PACE_LISTED_RUNS,
    })),
    bests: bests.map((b) => ({
      pack: packOf(b.list_id),
      mode: b.mode,
      amount: b.amount,
      wpmCx: b.wpm_cx,
      accuracyBp: b.accuracy_bp,
      achievedOn: dateOf(new Date(b.achieved_at)),
    })),
    lastDays: days.map((d) => ({
      day: d.challengeDay,
      pack: packOf(d.listId),
      wpmCx: d.wpmCx ?? 0,
      accuracyBp: d.accuracyBp ?? 0,
      place: d.finalRank,
    })),
  };
}

export interface PublicResult {
  id: string;
  username: string;
  pack: string;
  wpmCx: number;
  rawCx: number;
  accuracyBp: number;
  consistencyBp: number | null;
  challengeDay: string | null;
  finishedOn: string;
  series: number[] | null;
}

/** For /r/[id]. Only a ranked run of a listed typist has a public page. */
export async function publicResult(db: Db, id: string): Promise<PublicResult | null> {
  if (!isUuid(id)) return null;
  const [row] = await db
    .select({ result: results, username: profiles.username, listedAt: profiles.listedAt, bannedAt: profiles.bannedAt })
    .from(results)
    .innerJoin(profiles, eq(profiles.id, results.profileId))
    .where(eq(results.id, id))
    .limit(1);
  if (!row || !row.result.ranked || row.listedAt === null || row.bannedAt !== null || row.username === null || row.result.listId === null)
    return null;
  const { result } = row;
  return {
    id: result.id,
    username: row.username,
    pack: packOf(row.result.listId),
    wpmCx: result.wpmCx,
    rawCx: result.rawCx,
    accuracyBp: result.accuracyBp,
    consistencyBp: result.consistencyBp,
    challengeDay: result.challengeDay,
    finishedOn: dateOf(result.finishedAt),
    series: result.wpmSeries === null ? null : [...result.wpmSeries],
  };
}

const PROGRESS_RUNS = 500;
const PROGRESS_DAYS = 400;
const WEAK_KEY_DAYS = 35;

/** The private page: everything here is the typist's own, imports included and marked by their kind. */
export async function progressOf(db: Db, input: { clerkUserId: string; now: Date }) {
  const profile = await findProfile(db, input.clerkUserId);
  if (!profile) return null;
  const id = profile.id;
  const day = (ago: number) => new Date(input.now.getTime() - ago * 86_400_000).toISOString().slice(0, 10);
  const [runs, rollups, bests, paces, keys, lists] = await Promise.all([
    db.select(summaryColumns).from(results).where(eq(results.profileId, id)).orderBy(desc(results.finishedAt)).limit(PROGRESS_RUNS),
    rowsOf<{
      local_day: string;
      list_id: number;
      mode: 'time' | 'words';
      amount: number;
      runs: number;
      ms_typed: string;
      wpm_sum_cx: string;
      acc_sum_bp: string;
      best_wpm_cx: number;
    }>(
      db,
      sql`
        SELECT local_day::text, list_id::int, mode, amount::int, runs::int, ms_typed::text, wpm_sum_cx::text, acc_sum_bp::text, best_wpm_cx::int
        FROM daily_rollups WHERE profile_id = ${id} AND local_day >= ${day(PROGRESS_DAYS)}::date ORDER BY local_day
      `,
    ),
    db.select().from(personalBests).where(eq(personalBests.profileId, id)),
    db.select().from(ladder).where(eq(ladder.profileId, id)),
    db
      .select()
      .from(keyStats)
      .where(and(eq(keyStats.profileId, id), gte(keyStats.weekStart, day(WEAK_KEY_DAYS)))),
    db.select({ id: wordLists.id, language: wordLists.language }).from(wordLists),
  ]);
  const languageOf = new Map(lists.map((list) => [list.id, list.language as Language]));
  const merged = new Map<number, Buffer>();
  for (const row of keys) {
    const held = merged.get(row.listId);
    merged.set(row.listId, held ? mergeCounts(held, row.counts) : row.counts);
  }
  return {
    username: profile.username,
    rankingConsentAt: profile.rankingConsentAt,
    listedAt: profile.listedAt,
    bannedAt: profile.bannedAt,
    runs,
    rollups: rollups.map((r) => ({
      localDay: r.local_day,
      pack: packOf(r.list_id),
      mode: r.mode,
      amount: r.amount,
      runs: r.runs,
      msTyped: Number(r.ms_typed),
      wpmSumCx: Number(r.wpm_sum_cx),
      accSumBp: Number(r.acc_sum_bp),
      bestWpmCx: r.best_wpm_cx,
    })),
    bests: bests.map((b) => ({
      pack: packOf(b.listId),
      mode: b.mode,
      amount: b.amount,
      wpmCx: b.wpmCx,
      accuracyBp: b.accuracyBp,
      resultId: b.resultId,
      achievedAt: b.achievedAt,
    })),
    paces: paces.map((p) => ({
      pack: packOf(p.listId),
      paceCx: p.paceCx,
      runs: p.runsInWindow,
      listed: p.runsInWindow >= PACE_LISTED_RUNS,
    })),
    keys: [...merged].map(([listId, counts]) => ({ pack: packOf(listId), counts: decodeCounts(counts, languageOf.get(listId) ?? 'en') })),
  };
}
