import { createHash } from 'node:crypto';
import { z } from 'zod';
import { type Config, type LogEntry, type State } from '@/engine/core';
import { buildText, wordCountForDuration } from '@/engine/generate';
import { decodeLog, encodeLog, maxLogBytes, maxLogBytesForWords } from '@/engine/log';
import { RANKED_PACK } from '@/engine/packs';
import { findPack } from '@/engine/packs/server';
import { configFor } from '@/engine/presets';
import { replay } from '@/engine/replay';
import { SCORER_VERSION, type Score } from '@/engine/score';
import { consistency, entriesInRun, speedSeries } from '@/engine/analysis';
import { splitSubmission } from './frame';
import { type PlausibilityConfig, checkRun, extractFeatures } from './plausibility';
import { type Ticket, type TicketFailure, readTicket, verifyStamp } from './tickets';

const MAX_META_BYTES = 4096;
// Header, meta, and the longest log any ticket allows.
export const MAX_BODY_BYTES = 3 + MAX_META_BYTES + maxLogBytes(120_000);

export const RANKED_SECONDS = 60;
export const RANKED_MIN_ACCURACY_BP = 8500;
const SERIES_MAX_POINTS = 240;

// Before iat a run cannot have begun, and a retry only ever arrives later, so this is the one arrival-based check. It can't
// punish a slow link. The grace is for clock differences between serverless instances.
const EARLY_ARRIVAL_GRACE_MS = 1500;

export type Rejection = 'too-large' | 'malformed' | TicketFailure | 'unknown-scorer' | 'bad-log' | 'replay-failed' | 'too-early';

const metaSchema = z.strictObject({
  ticket: z.string().max(2048),
  start: z.string().max(1024).nullable(),
  end: z.string().max(1024).nullable(),
  device: z.enum(['keyboard', 'touch']),
  timeZone: z
    .string()
    .max(64)
    .regex(/^[A-Za-z0-9_+\-/]+$/),
  confirms: z.uuid().nullable(),
});

type Meta = z.infer<typeof metaSchema>;

/** Counts while reading, because Content-Length can be absent or wrong and the body is the attacker's. Null means over the cap. */
export async function readCapped(body: ReadableStream<Uint8Array> | null, cap = MAX_BODY_BYTES): Promise<Uint8Array | null> {
  if (body === null) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > cap) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

export interface Prepared {
  ticket: Ticket;
  meta: Meta;
  log: Uint8Array;
  bodyHash: Buffer;
}

export type Prepare = { ok: true; prepared: Prepared } | { ok: false; reason: Rejection };

/** Everything that needs no replay, so a retry can be answered from the stored row without running the engine again. */
export function prepareSubmission(bytes: Uint8Array): Prepare {
  if (bytes.length > MAX_BODY_BYTES) return { ok: false, reason: 'too-large' };
  const frame = splitSubmission(bytes);
  if (frame === null || frame.metaBytes.length > MAX_META_BYTES) return { ok: false, reason: 'malformed' };
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(frame.metaBytes));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  // Strict: a body naming a wpm or an accuracy is not a body this server reads.
  const meta = metaSchema.safeParse(json);
  if (!meta.success) return { ok: false, reason: 'malformed' };
  const check = readTicket(meta.data.ticket);
  if (!check.ok) return check;
  const bodyHash = createHash('sha256').update(frame.log).digest();
  return { ok: true, prepared: { ticket: check.ticket, meta: meta.data, log: frame.log, bodyHash } };
}

export type Retry = 'same' | 'conflict';

/** A nonce already stored: the same user and bytes is a retry, anything else is someone reusing a ticket. */
export function judgeRetry(stored: { profileId: number; bodyHash: Buffer | null }, profileId: number, bodyHash: Buffer): Retry {
  return stored.profileId === profileId && stored.bodyHash !== null && stored.bodyHash.equals(bodyHash) ? 'same' : 'conflict';
}

export type RunStatus = 'passed' | 'held' | 'unverified';

export interface VerifiedRun {
  ticket: Ticket;
  config: Config;
  words: readonly string[];
  state: State;
  score: Score;
  /** In memory for the request only: holds are read here and never written. Use flightLog to store anything. */
  entries: readonly LogEntry[];
  bodyHash: Buffer;
  device: 'keyboard' | 'touch';
  confirms: string | null;
  consistencyBp: number | null;
  series: Buffer | null;
  status: RunStatus;
  /** A stamp disagreed with the run or the ticket went stale. Nothing later can prove the timing, so it can never rank. */
  downgraded: boolean;
  reasons: string[];
  startMs: number | null;
  endMs: number | null;
  finishedAtMs: number;
  localDay: string;
}

export type Verification = { ok: true; run: VerifiedRun } | { ok: false; reason: Rejection };

function capFor(ticket: Ticket): number {
  return ticket.mode === 'time' ? maxLogBytes(ticket.amount * 1000) : maxLogBytesForWords(ticket.amount);
}

export function configOf(ticket: Pick<Ticket, 'mode' | 'amount'>): Config {
  return configFor(ticket.mode === 'time' ? { kind: 'time', seconds: ticket.amount } : { kind: 'words', count: ticket.amount });
}

/** The text a ticket names, from its pack and seed alone. */
export function wordsOf(ticket: Pick<Ticket, 'mode' | 'amount' | 'pack' | 'seed'>): string[] | null {
  const pack = findPack(ticket.pack);
  if (pack === undefined) return null;
  const count = ticket.mode === 'time' ? wordCountForDuration(ticket.amount * 1000) : ticket.amount;
  return buildText({ seed: ticket.seed, count }, pack.words);
}

function localDayOf(epochMs: number, timeZone: string): string {
  const format = (zone: string): string => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(
      epochMs,
    );
    const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  };
  try {
    return format(timeZone);
  } catch {
    return format('UTC');
  }
}

function seriesOf(config: Config, words: readonly string[], entries: readonly LogEntry[]): Buffer | null {
  const points = speedSeries(config, words, entries);
  if (points.length === 0 || points.length > SERIES_MAX_POINTS) return null;
  return Buffer.from(points.map((point) => Math.min(255, Math.max(0, Math.round(point.net)))));
}

interface TimeJudgement {
  hold: string[];
  downgrade: string[];
}

/**
 * Judges the stamps, never the arrival: a run may sit in the outbox for days and a retry must not cost it anything.
 * A stamp that disagrees with the run could be a slow link as easily as a stretched clock, so it downgrades and never rejects.
 */
function judgeTime(
  ticket: Ticket,
  elapsedMs: number,
  wpmCx: number,
  startMs: number | null,
  endMs: number | null,
  now: number,
  config: PlausibilityConfig | null,
): TimeJudgement {
  const out: TimeJudgement = { hold: [], downgrade: [] };
  // A start stamp is only ever issued on a live ticket, so having one proves the start was in time.
  if (startMs === null && now > ticket.exp) out.downgrade.push('ticket-expired');
  if (config === null || wpmCx < config.gateWpmCx) return out;
  if (startMs === null || endMs === null) {
    out.hold.push('stamp-missing');
    return out;
  }
  const span = endMs - startMs;
  if (span < elapsedMs - config.stampEarlyMs) out.downgrade.push('stamp-short');
  if (span > elapsedMs + config.stampLateMs) out.downgrade.push('stamp-long');
  return out;
}

/** Replays with the engine and decides the status. Reads no number from the client, because the body contains none. */
export function verifyRun(prepared: Prepared, now: number, plausibility: PlausibilityConfig | null): Verification {
  const { ticket, meta, log, bodyHash } = prepared;
  if (log.length > capFor(ticket)) return { ok: false, reason: 'too-large' };
  if (ticket.scorer !== SCORER_VERSION) return { ok: false, reason: 'unknown-scorer' };
  const words = wordsOf(ticket);
  if (words === null) return { ok: false, reason: 'malformed' };
  const entries = decodeLog(log);
  if (entries === null) return { ok: false, reason: 'bad-log' };
  const config = configOf(ticket);
  const result = replay(config, words, entries);
  if (!result.valid) return { ok: false, reason: 'replay-failed' };
  const { wpmCx, elapsedMs } = result.score;
  if (now - ticket.iat < elapsedMs - EARLY_ARRIVAL_GRACE_MS) return { ok: false, reason: 'too-early' };

  const inRun = entriesInRun(config, words, entries);
  const startMs = verifyStamp(meta.start, ticket.nonce, 'start');
  const endMs = verifyStamp(meta.end, ticket.nonce, 'end');
  const time = judgeTime(ticket, elapsedMs, wpmCx, startMs, endMs, now, plausibility);
  const checks = checkRun({ wpmCx, mode: ticket.mode, amount: ticket.amount, features: extractFeatures(inRun) }, plausibility);
  const held = [...checks, ...time.hold];
  const status: RunStatus = held.length > 0 ? 'held' : time.downgrade.length > 0 ? 'unverified' : 'passed';
  const consistencyValue = consistency(inRun);
  const finishedAtMs = endMs ?? now;
  return {
    ok: true,
    run: {
      ticket,
      config,
      words,
      state: result.state,
      score: result.score,
      entries: inRun,
      bodyHash,
      device: meta.device,
      confirms: meta.confirms,
      consistencyBp: consistencyValue === null ? null : Math.round(consistencyValue * 100),
      series: seriesOf(config, words, inRun),
      status,
      downgraded: time.downgrade.length > 0,
      reasons: [...held, ...time.downgrade],
      startMs,
      endMs,
      finishedAtMs,
      localDay: localDayOf(finishedAtMs, meta.timeZone),
    },
  };
}

export interface ProfileGates {
  username: string | null;
  rankingConsentAt: Date | null;
  bannedAt: Date | null;
}

/** PLAN's eligibility, apart from "not held" and the single-use ticket, which the caller and the primary key enforce. */
export function failedGates(run: Pick<VerifiedRun, 'ticket' | 'score' | 'device'>, profile: ProfileGates): string[] {
  const failed: string[] = [];
  if (profile.username === null) failed.push('no-username');
  if (profile.rankingConsentAt === null) failed.push('no-consent');
  if (profile.bannedAt !== null) failed.push('banned');
  if (RANKED_PACK[run.ticket.language] !== run.ticket.pack) failed.push('list-not-ranked');
  if (run.ticket.mode !== 'time' || run.ticket.amount !== RANKED_SECONDS) failed.push('not-sixty-seconds');
  if (run.score.accuracyBp < RANKED_MIN_ACCURACY_BP) failed.push('low-accuracy');
  if (run.device !== 'keyboard') failed.push('touch-keyboard');
  return failed;
}

/**
 * What a replay row may hold: flight times only. The holds are gone before the bytes exist. Times restart at the first key,
 * because the ignored keys that came before it are not here to carry the delta, and a forged gap can exceed what one holds.
 */
export function flightLog(entries: readonly LogEntry[]): Buffer {
  const origin = entries[0]?.t ?? 0;
  return Buffer.from(
    encodeLog(
      entries.map((entry) => {
        const copy = { ...entry, t: entry.t - origin };
        delete copy.h;
        return copy;
      }),
    ),
  );
}
