import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// drizzle-orm 0.45.4 ships no bytea column. PGlite hands back a Uint8Array and pg a Buffer, so both come out as Buffer.
const bytea = customType<{ data: Buffer; driverData: Uint8Array }>({
  dataType: () => 'bytea',
  fromDriver: (value) => Buffer.from(value),
});
const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const profileId = (name: string) => bigint(name, { mode: 'number' });

export const resultKind = pgEnum('result_kind', ['free', 'daily', 'import']);
export const resultStatus = pgEnum('result_status', ['passed', 'held', 'voided', 'unverified']);
export const deviceClass = pgEnum('device_class', ['keyboard', 'touch', 'unknown']);
export const runMode = pgEnum('run_mode', ['time', 'words']);
export const reportTarget = pgEnum('report_target', ['username', 'result', 'appeal']);
export const reportStatus = pgEnum('report_status', ['open', 'upheld', 'dismissed']);
export const adminAction = pgEnum('admin_action', ['dismiss', 'release', 'void', 'ban', 'rename']);

// Seeded by a migration and kept in step with the packs by a test.
export const wordLists = pgTable('word_lists', {
  id: smallint('id').primaryKey(),
  packId: text('pack_id').notNull().unique(),
  language: text('language').notNull(),
  sha256: text('sha256').notNull(),
  ranked: boolean('ranked').notNull().default(false),
});

export const profiles = pgTable(
  'profiles',
  {
    id: profileId('id').primaryKey().generatedAlwaysAsIdentity(),
    clerkUserId: text('clerk_user_id').notNull().unique(),
    username: text('username').unique(),
    rankingConsentAt: tstz('ranking_consent_at'),
    listedAt: tstz('listed_at'),
    bannedAt: tstz('banned_at'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('username_format', sql`${t.username} ~ '^[a-z0-9][a-z0-9_-]{2,19}$'`),
    check('listed_needs_username', sql`${t.listedAt} IS NULL OR ${t.username} IS NOT NULL`),
    check('consent_needs_username', sql`${t.rankingConsentAt} IS NULL OR ${t.username} IS NOT NULL`),
  ],
);

export const usernameHolds = pgTable(
  'username_holds',
  {
    username: text('username').primaryKey(),
    profileId: profileId('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    releaseAt: tstz('release_at').notNull(),
  },
  (t) => [index('username_holds_profile_idx').on(t.profileId)],
);

// id is the ticket nonce, so a replayed ticket fails the primary key. Imports use the client's uuid and carry no proof.
export const results = pgTable(
  'results',
  {
    id: uuid('id').primaryKey(),
    profileId: profileId('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    listId: smallint('list_id').references(() => wordLists.id),
    kind: resultKind('kind').notNull(),
    status: resultStatus('status').notNull(),
    ranked: boolean('ranked').notNull().default(false),
    // Passed every gate apart from a hold or a downgrade, so releasing a hold knows whether the run may rank.
    rankable: boolean('rankable').notNull().default(false),
    mode: runMode('mode').notNull(),
    // Seconds in time mode, words in words mode.
    amount: smallint('amount').notNull(),
    wpmCx: integer('wpm_cx').notNull(),
    rawCx: integer('raw_cx').notNull(),
    accuracyBp: integer('accuracy_bp').notNull(),
    consistencyBp: integer('consistency_bp'),
    elapsedMs: integer('elapsed_ms').notNull(),
    seed: bytea('seed'),
    scorerVersion: smallint('scorer_version'),
    bodyHash: bytea('body_hash'),
    device: deviceClass('device').notNull().default('unknown'),
    challengeDay: date('challenge_day'),
    localDay: date('local_day').notNull(),
    finishedAt: tstz('finished_at').notNull(),
    // One byte per second, WPM clamped to 255, for the permalink's chart.
    wpmSeries: bytea('wpm_series'),
    // Names of the checks that tripped, for the review queue. Never sent to the client, and never a hold time.
    holdReasons: text('hold_reasons').array(),
    reviewedAt: tstz('reviewed_at'),
    confirmedBy: uuid('confirmed_by'),
    newBest: boolean('new_best').notNull().default(false),
    previousBestCx: integer('previous_best_cx'),
  },
  (t) => [
    // .desc() alone emits DESC NULLS LAST, which a plain ORDER BY x DESC cannot use.
    index('results_profile_time_idx').on(t.profileId, t.finishedAt.desc().nullsFirst()),
    index('results_ranked_idx').on(t.profileId, t.listId, t.finishedAt.desc().nullsFirst()).where(sql`${t.ranked}`),
    index('results_held_idx').on(t.finishedAt).where(sql`${t.status} = 'held'`),
    check('wpm_range', sql`${t.wpmCx} >= 0 AND ${t.rawCx} >= 0`),
    check('accuracy_range', sql`${t.accuracyBp} BETWEEN 0 AND 10000`),
    check('ranked_needs_passed', sql`NOT ${t.ranked} OR (${t.status} = 'passed' AND ${t.rankable})`),
    check(
      'import_is_private',
      sql`${t.kind} <> 'import' OR (${t.status} = 'unverified' AND NOT ${t.ranked} AND NOT ${t.rankable} AND NOT ${t.newBest})`,
    ),
    check(
      'run_has_proof',
      sql`${t.kind} = 'import' OR (${t.listId} IS NOT NULL AND ${t.seed} IS NOT NULL AND ${t.scorerVersion} IS NOT NULL AND ${t.bodyHash} IS NOT NULL)`,
    ),
  ],
);

// Stored so that rotating the secret never loses a past day's text.
export const dailyChallenges = pgTable(
  'daily_challenges',
  {
    challengeDay: date('challenge_day').notNull(),
    listId: smallint('list_id')
      .notNull()
      .references(() => wordLists.id),
    seed: bytea('seed').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.challengeDay, t.listId] })],
);

// The row exists from reveal: the attempt is spent even if the run never finishes.
export const dailyEntries = pgTable(
  'daily_entries',
  {
    challengeDay: date('challenge_day').notNull(),
    listId: smallint('list_id')
      .notNull()
      .references(() => wordLists.id),
    profileId: profileId('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    ticketNonce: uuid('ticket_nonce').notNull(),
    startedAt: tstz('started_at').notNull().defaultNow(),
    // No FK on any result_id: every deleted result would scan each referrer. Measured 154.6 s against 0.2 s for a 230-run account.
    resultId: uuid('result_id'),
    wpmCx: integer('wpm_cx'),
    accuracyBp: integer('accuracy_bp'),
    finishedAt: tstz('finished_at'),
    // Finished, ranked, listed, consenting and not banned.
    visible: boolean('visible').notNull().default(false),
    finalRank: integer('final_rank'),
  },
  (t) => [
    primaryKey({ columns: [t.challengeDay, t.listId, t.profileId] }),
    index('daily_board_idx')
      .on(t.challengeDay, t.listId, t.wpmCx.desc().nullsFirst(), t.accuracyBp.desc().nullsFirst(), t.finishedAt, t.profileId)
      .where(sql`${t.visible}`),
    index('daily_profile_idx').on(t.profileId, t.challengeDay.desc().nullsFirst()),
  ],
);

export const ladder = pgTable(
  'ladder',
  {
    profileId: profileId('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    listId: smallint('list_id')
      .notNull()
      .references(() => wordLists.id),
    paceCx: integer('pace_cx').notNull(),
    bestCx: integer('best_cx').notNull(),
    runsInWindow: smallint('runs_in_window').notNull(),
    lastRankedAt: tstz('last_ranked_at').notNull(),
    // When this leaves the 90-day window Pace must change, so the daily job recomputes only those rows.
    oldestInWindowAt: tstz('oldest_in_window_at').notNull(),
    // 10 runs in the window, active in 30 days, listed, consenting and not banned.
    eligible: boolean('eligible').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.profileId, t.listId] }),
    index('ladder_board_idx').on(t.listId, t.paceCx.desc().nullsFirst(), t.profileId).where(sql`${t.eligible}`),
  ],
);

export const personalBests = pgTable(
  'personal_bests',
  {
    profileId: profileId('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    listId: smallint('list_id')
      .notNull()
      .references(() => wordLists.id),
    mode: runMode('mode').notNull(),
    amount: smallint('amount').notNull(),
    wpmCx: integer('wpm_cx').notNull(),
    accuracyBp: integer('accuracy_bp').notNull(),
    resultId: uuid('result_id').notNull(),
    achievedAt: tstz('achieved_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.listId, t.mode, t.amount] })],
);

export const dailyRollups = pgTable(
  'daily_rollups',
  {
    profileId: profileId('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    localDay: date('local_day').notNull(),
    listId: smallint('list_id')
      .notNull()
      .references(() => wordLists.id),
    mode: runMode('mode').notNull(),
    amount: smallint('amount').notNull(),
    runs: integer('runs').notNull(),
    msTyped: bigint('ms_typed', { mode: 'number' }).notNull(),
    // bigint because a held forgery can claim up to 2^31 centi-WPM per run.
    wpmSumCx: bigint('wpm_sum_cx', { mode: 'number' }).notNull(),
    accSumBp: bigint('acc_sum_bp', { mode: 'number' }).notNull(),
    bestWpmCx: integer('best_wpm_cx').notNull(),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.localDay, t.listId, t.mode, t.amount] })],
);

// Weekly, because a daily row per key set would outweigh results. Bytes rather than JSONB: 85 B against 1,052 B measured.
export const keyStats = pgTable(
  'key_stats',
  {
    profileId: profileId('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    listId: smallint('list_id')
      .notNull()
      .references(() => wordLists.id),
    weekStart: date('week_start').notNull(),
    counts: bytea('counts').notNull(),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.listId, t.weekStart] })],
);

// Normally empty: only held and top-10 runs, for 30 days. The log inside holds flight times and no hold times.
export const replays = pgTable(
  'replays',
  {
    resultId: uuid('result_id').primaryKey(),
    profileId: profileId('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    log: bytea('log').notNull(),
    purgeAfter: tstz('purge_after').notNull(),
  },
  (t) => [index('replays_purge_idx').on(t.purgeAfter), index('replays_profile_idx').on(t.profileId)],
);

export const reports = pgTable(
  'reports',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    target: reportTarget('target').notNull(),
    reporterId: profileId('reporter_id').references(() => profiles.id, { onDelete: 'set null' }),
    subjectId: profileId('subject_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    resultId: uuid('result_id'),
    note: text('note'),
    status: reportStatus('status').notNull().default('open'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    resolvedAt: tstz('resolved_at'),
    resolution: text('resolution'),
  },
  (t) => [
    index('reports_queue_idx').on(t.createdAt).where(sql`${t.status} = 'open'`),
    index('reports_result_idx').on(t.resultId).where(sql`${t.resultId} IS NOT NULL`),
    index('reports_reporter_idx').on(t.reporterId),
    index('reports_subject_idx').on(t.subjectId),
    index('reports_resolved_idx').on(t.resolvedAt).where(sql`${t.resolvedAt} IS NOT NULL`),
    // Two indexes, because NULLs are distinct in a unique index and a username report has no result.
    uniqueIndex('reports_one_open_subject_idx')
      .on(t.reporterId, t.target, t.subjectId)
      .where(sql`${t.status} = 'open' AND ${t.resultId} IS NULL`),
    uniqueIndex('reports_one_open_result_idx')
      .on(t.reporterId, t.target, t.resultId)
      .where(sql`${t.status} = 'open' AND ${t.resultId} IS NOT NULL`),
    check('note_length', sql`char_length(${t.note}) <= 280`),
  ],
);

export const adminAudit = pgTable(
  'admin_audit',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    adminClerkId: text('admin_clerk_id').notNull(),
    action: adminAction('action').notNull(),
    // Cascades because deletion is hard: an audit row must not keep a deleted typist's identity alive.
    subjectId: profileId('subject_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    resultId: uuid('result_id'),
    reportId: bigint('report_id', { mode: 'number' }),
    note: text('note'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [index('admin_audit_subject_idx').on(t.subjectId)],
);

// A counter rather than the WAF: the limit is per user, and Hobby's firewall counts only by IP.
export const rateCounters = pgTable(
  'rate_counters',
  {
    profileId: profileId('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    bucket: text('bucket').notNull(),
    windowStart: tstz('window_start').notNull(),
    hits: integer('hits').notNull(),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.bucket, t.windowStart] }), index('rate_counters_window_idx').on(t.windowStart)],
);
