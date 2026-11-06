import type { LogEntry } from '@/engine/core';
import { encodeLog } from '@/engine/log';
import { RANKED_PACK, type Language } from '@/engine/packs';
import { encodeSubmission, type SubmissionMeta } from '@/server/frame';
import { type Ticket, type TicketRequest, issueStamp, issueTicket } from '@/server/tickets';
import { wordsOf } from '@/server/verify';
import { type Shape, humanShape, typed } from './logs';

export const SECRET = 'k1:test-only-secret-test-only-secret-test-only';

export function rankedRequest(language: Language = 'en'): TicketRequest {
  return { language, pack: RANKED_PACK[language], mode: 'time', amount: 60 };
}

export interface Built {
  token: string;
  ticket: Ticket;
  entries: LogEntry[];
  log: Uint8Array;
  body: Uint8Array;
}

export interface BuildOptions {
  request?: TicketRequest;
  /** An already issued ticket, for a daily run. */
  issued?: { token: string; ticket: Ticket };
  shape?: Shape;
  seed?: number;
  iat?: number;
  /** ms after iat for each stamp. Null sends none. */
  startAfter?: number | null;
  endAfter?: number | null;
  meta?: Partial<SubmissionMeta>;
  /** Replaces the typed log entirely. */
  entries?: LogEntry[];
  mapEntries?: (entries: LogEntry[], words: readonly string[]) => LogEntry[];
}

export function buildRun(options: BuildOptions = {}): Built {
  const iat = options.iat ?? 1_800_000_000_000;
  const { token, ticket } = options.issued ?? issueTicket(options.request ?? rankedRequest(), iat);
  const words = wordsOf(ticket);
  if (words === null) throw new Error('no such pack');
  const duration = ticket.mode === 'time' ? ticket.amount * 1000 : 3_600_000;
  const base = options.entries ?? typed(words, duration, options.shape ?? humanShape(100), options.seed ?? 1);
  const entries = options.mapEntries ? options.mapEntries(base, words) : base;
  const log = encodeLog(entries);
  const stampAt = (phase: 'start' | 'end', after: number | null | undefined, fallback: number): string | null => {
    const value = after === undefined ? fallback : after;
    return value === null ? null : issueStamp(token, phase, ticket.iat + value);
  };
  const body = encodeSubmission(
    {
      ticket: token,
      start: stampAt('start', options.startAfter, 1000),
      end: stampAt('end', options.endAfter, 1000 + (ticket.mode === 'time' ? ticket.amount * 1000 : 60_000)),
      device: 'keyboard',
      timeZone: 'America/Sao_Paulo',
      confirms: null,
      ...options.meta,
    },
    log,
  );
  return { token, ticket, entries, log, body };
}

/** Types the given words exactly, then sits, so a test can pick a precise score. */
export function perfectPrefix(words: readonly string[], keyCount: number, msPerKey: number): LogEntry[] {
  const out: LogEntry[] = [];
  let t = 0;
  for (const word of words) {
    for (const ch of word) {
      if (out.length === keyCount) return out;
      out.push({ k: 'c', ch, t, h: 70 });
      t += msPerKey;
    }
    if (out.length === keyCount) return out;
    out.push({ k: 's', t, h: 70 });
    t += msPerKey;
  }
  return out;
}
