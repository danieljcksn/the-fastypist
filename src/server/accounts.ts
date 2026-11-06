import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Db, rowsOf } from '@/db/client';
import { LIST_IDS } from '@/db/lists';
import {
  dailyEntries,
  dailyRollups,
  keyStats,
  ladder,
  personalBests,
  profiles,
  replays,
  reports,
  results,
  usernameHolds,
} from '@/db/schema';
import { challengeDay } from '@/engine/day';
import { isPackId } from '@/engine/packs';
import { hitCounter, refreshVisibility } from './standing';
import { type UsernameProblem, normalizeUsername, usernameProblem } from './username';

const USERNAME_HOLD_MS = 30 * 86_400_000;
// Each rename holds the old name for 30 days, so an unlimited rename is a way to reserve every good name there is.
const RENAMES_PER_DAY = 3;
export const IMPORT_CAP = 500;

export type Profile = typeof profiles.$inferSelect;

/** Postgres's unique_violation, which drizzle wraps in an error of its own. */
export function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    if ((e as Error & { code?: unknown }).code === '23505') return true;
  }
  return false;
}

/** The lazy upsert that makes this table the source of truth: webhooks update rows and never insert them. */
export async function ensureProfile(db: Db, clerkUserId: string): Promise<Profile> {
  const select = () => db.select().from(profiles).where(eq(profiles.clerkUserId, clerkUserId)).limit(1);
  const [existing] = await select();
  if (existing) return existing;
  await db.insert(profiles).values({ clerkUserId }).onConflictDoNothing();
  const [created] = await select();
  if (!created) throw new Error('profile vanished right after its upsert');
  return created;
}

export async function findProfile(db: Db, clerkUserId: string): Promise<Profile | null> {
  const [row] = await db.select().from(profiles).where(eq(profiles.clerkUserId, clerkUserId)).limit(1);
  return row ?? null;
}

export type ClaimOutcome = { ok: true; username: string } | { ok: false; problem: UsernameProblem | 'taken' | 'held' | 'rate-limited' };

class NameRefused extends Error {
  constructor(readonly problem: 'held' | 'rate-limited') {
    super(problem);
  }
}

/**
 * Serializes every change touching these names, sorted so that two renames can't deadlock. Without it a claim can read no
 * hold, then wait on the unique index while the owner's rename commits, and win the name the hold was just written to protect.
 */
export async function lockNames(tx: Db, names: string[]): Promise<void> {
  for (const name of [...names].sort()) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`username:${name}`}, 0))`);
  }
}

/** Also a rename: the old name stays out of reach of others for 30 days, so nobody can step into someone's reputation. */
export async function claimUsername(db: Db, input: { clerkUserId: string; username: string; now: Date }): Promise<ClaimOutcome> {
  const username = normalizeUsername(input.username);
  const problem = usernameProblem(username);
  if (problem !== null) return { ok: false, problem };
  const { id } = await ensureProfile(db, input.clerkUserId);
  try {
    await db.transaction(async (tx) => {
      const [profile] = await tx.select().from(profiles).where(eq(profiles.id, id)).for('update');
      if (!profile) throw new Error('profile vanished during a claim');
      if (profile.username === username) return;
      await lockNames(tx, profile.username === null ? [username] : [profile.username, username]);
      const [hold] = await tx
        .select()
        .from(usernameHolds)
        .where(and(eq(usernameHolds.username, username), gt(usernameHolds.releaseAt, input.now)))
        .limit(1);
      if (hold && (hold.forced || hold.profileId !== profile.id)) throw new NameRefused('held');
      const dayStart = new Date(input.now.getTime() - (input.now.getTime() % 86_400_000));
      if ((await hitCounter(tx, profile.id, 'rename', dayStart)) > RENAMES_PER_DAY) throw new NameRefused('rate-limited');
      await applyUsername(tx, profile, username, input.now);
    });
  } catch (error) {
    if (error instanceof NameRefused) return { ok: false, problem: error.problem };
    if (isUniqueViolation(error)) return { ok: false, problem: 'taken' };
    throw error;
  }
  return { ok: true, username };
}

export async function applyUsername(
  tx: Db,
  profile: Pick<Profile, 'id' | 'username'>,
  username: string,
  now: Date,
  forced = false,
): Promise<void> {
  if (profile.username !== null) {
    const releaseAt = new Date(now.getTime() + USERNAME_HOLD_MS);
    await tx
      .insert(usernameHolds)
      .values({ username: profile.username, profileId: profile.id, releaseAt, forced })
      .onConflictDoUpdate({ target: usernameHolds.username, set: { profileId: profile.id, releaseAt, forced } });
  }
  await tx.delete(usernameHolds).where(eq(usernameHolds.username, username));
  await tx.update(profiles).set({ username }).where(eq(profiles.id, profile.id));
}

/** The one step that asks for a username: a separate, recorded consent, and listing as a choice of its own. */
export async function optIntoRanking(
  db: Db,
  input: { clerkUserId: string; username: string; listed: boolean; now: Date },
): Promise<ClaimOutcome> {
  const claim = await claimUsername(db, input);
  if (!claim.ok) return claim;
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(profiles)
      .set({ rankingConsentAt: input.now, listedAt: input.listed ? input.now : null })
      .where(eq(profiles.clerkUserId, input.clerkUserId))
      .returning({ id: profiles.id });
    if (updated) await refreshVisibility(tx, updated.id, challengeDay(input.now.getTime()), input.now);
  });
  return claim;
}

export async function setListed(db: Db, input: { clerkUserId: string; listed: boolean; now: Date }): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [profile] = await tx.select().from(profiles).where(eq(profiles.clerkUserId, input.clerkUserId)).limit(1);
    if (!profile || (input.listed && (profile.username === null || profile.rankingConsentAt === null))) return false;
    await tx
      .update(profiles)
      .set({ listedAt: input.listed ? input.now : null })
      .where(eq(profiles.id, profile.id));
    await refreshVisibility(tx, profile.id, challengeDay(input.now.getTime()), input.now);
    return true;
  });
}

/** Stops ranking and erases stored flight times, as the consent text promises. The typist's own results stay theirs. */
export async function withdrawRankingConsent(db: Db, input: { clerkUserId: string; now: Date }): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [profile] = await tx
      .update(profiles)
      .set({ rankingConsentAt: null, listedAt: null })
      .where(eq(profiles.clerkUserId, input.clerkUserId))
      .returning({ id: profiles.id });
    if (!profile) return false;
    await tx.delete(replays).where(eq(replays.profileId, profile.id));
    await refreshVisibility(tx, profile.id, challengeDay(input.now.getTime()), input.now);
    return true;
  });
}

const importRowSchema = z.strictObject({
  id: z.uuid(),
  pack: z.string().max(32).nullable(),
  mode: z.enum(['time', 'words']),
  amount: z.number().int().min(0).max(32_000),
  wpmCx: z.number().int().min(0).max(1_000_000),
  rawCx: z.number().int().min(0).max(1_000_000),
  accuracyBp: z.number().int().min(0).max(10_000),
  consistencyBp: z.number().int().min(0).max(10_000).nullable(),
  elapsedMs: z.number().int().min(0).max(86_400_000),
  finishedAt: z.iso.datetime(),
  localDay: z.iso.date(),
});

export type ImportRow = z.infer<typeof importRowSchema>;

export interface ImportOutcome {
  imported: number;
  skipped: number;
}

/**
 * Forging local history can only fool yourself, so these are stored as claimed and marked: kind import, status unverified,
 * never ranked, and the schema's import_is_private check forbids anything else. They feed no personal best, no Pace, no
 * rollup and no board. Newest first, so the cap keeps the runs someone is most likely to look at.
 */
export async function importHistory(db: Db, input: { clerkUserId: string; rows: unknown[]; now: Date }): Promise<ImportOutcome> {
  const profile = await ensureProfile(db, input.clerkUserId);
  const valid: ImportRow[] = [];
  for (const row of input.rows.slice(0, IMPORT_CAP * 2)) {
    const parsed = importRowSchema.safeParse(row);
    if (parsed.success) valid.push(parsed.data);
  }
  valid.sort((a, b) => (a.finishedAt < b.finishedAt ? 1 : -1));
  return db.transaction(async (tx) => {
    const [count] = await rowsOf<{ n: number }>(
      tx,
      sql`SELECT count(*)::int AS n FROM results WHERE profile_id = ${profile.id} AND kind = 'import'`,
    );
    const room = Math.max(0, IMPORT_CAP - (count?.n ?? 0));
    const taken = valid.slice(0, room);
    if (taken.length === 0) return { imported: 0, skipped: input.rows.length };
    const inserted = await tx
      .insert(results)
      .values(
        taken.map((row) => {
          const finishedAt = new Date(row.finishedAt);
          return {
            id: row.id,
            profileId: profile.id,
            listId: row.pack !== null && isPackId(row.pack) ? LIST_IDS[row.pack] : null,
            kind: 'import' as const,
            status: 'unverified' as const,
            mode: row.mode,
            amount: row.amount,
            wpmCx: row.wpmCx,
            rawCx: row.rawCx,
            accuracyBp: row.accuracyBp,
            consistencyBp: row.consistencyBp,
            elapsedMs: row.elapsedMs,
            localDay: row.localDay,
            finishedAt: finishedAt > input.now ? input.now : finishedAt,
          };
        }),
      )
      .onConflictDoNothing()
      .returning({ id: results.id });
    return { imported: inserted.length, skipped: input.rows.length - inserted.length };
  });
}

const hex = (value: Buffer | null): string | null => (value === null ? null : value.toString('hex'));

function without<T extends object, K extends keyof T>(row: T, ...keys: K[]): Omit<T, K> {
  const copy = { ...row };
  for (const key of keys) delete copy[key];
  return copy;
}

/**
 * What the database holds about this person, for LGPD art. 18 V and GDPR art. 20. Two things stay out: which check held a
 * run, since a per-run answer is how a bot's author would tune against the thresholds, and moderators' audit rows.
 */
export async function exportAccount(db: Db, clerkUserId: string): Promise<Record<string, unknown> | null> {
  const profile = await findProfile(db, clerkUserId);
  if (!profile) return null;
  const id = profile.id;
  const [runRows, bests, rollups, today, standings, keys, stored, filed, holds] = await Promise.all([
    db.select().from(results).where(eq(results.profileId, id)).orderBy(desc(results.finishedAt)),
    db.select().from(personalBests).where(eq(personalBests.profileId, id)),
    db.select().from(dailyRollups).where(eq(dailyRollups.profileId, id)),
    db.select().from(dailyEntries).where(eq(dailyEntries.profileId, id)),
    db.select().from(ladder).where(eq(ladder.profileId, id)),
    db.select().from(keyStats).where(eq(keyStats.profileId, id)),
    db.select().from(replays).where(eq(replays.profileId, id)),
    db.select().from(reports).where(eq(reports.reporterId, id)),
    db.select().from(usernameHolds).where(eq(usernameHolds.profileId, id)),
  ]);
  return {
    exportedFormat: 1,
    profile: without(profile, 'id', 'clerkUserId'),
    results: runRows.map((row) => ({
      ...without(row, 'profileId', 'holdReasons'),
      seed: hex(row.seed),
      bodyHash: hex(row.bodyHash),
      wpmSeries: row.wpmSeries === null ? null : [...row.wpmSeries],
    })),
    personalBests: bests.map((row) => without(row, 'profileId')),
    dailyRollups: rollups.map((row) => without(row, 'profileId')),
    dailyEntries: today.map((row) => without(row, 'profileId')),
    ladder: standings.map((row) => without(row, 'profileId')),
    keyStats: keys.map((row) => ({ ...without(row, 'profileId'), counts: row.counts.toString('base64') })),
    replays: stored.map((row) => ({ ...without(row, 'profileId', 'log'), flightLog: row.log.toString('base64') })),
    reportsFiled: filed.map((row) => without(row, 'reporterId', 'subjectId')),
    usernameHolds: holds.map((row) => without(row, 'profileId')),
  };
}

/** Hard delete: every table cascades through the profile, and this is safe to repeat for a webhook retry. */
export async function deleteAccount(db: Db, clerkUserId: string): Promise<boolean> {
  const deleted = await db.delete(profiles).where(eq(profiles.clerkUserId, clerkUserId)).returning({ id: profiles.id });
  return deleted.length > 0;
}
