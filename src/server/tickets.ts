import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { PACKS, PACK_IDS, type Language, type PackId } from '@/engine/packs';
import { SCORER_VERSION } from '@/engine/score';

export const TICKET_VERSION = 1;
export const TICKET_TTL_MS = 20 * 60_000;
export const TIME_SECONDS = [15, 30, 60, 120] as const;
export const WORD_COUNTS = [10, 25, 50, 100] as const;

const MAX_TOKEN_CHARS = 2048;
const MIN_SECRET_CHARS = 32;
const MAC_BYTES = 32;
const KID = /^[a-z0-9]{1,16}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

// Domain strings keep a stamp from ever verifying as a ticket, or the reverse, under the same key.
type Domain = 'ticket' | 'stamp';

const ticketSchema = z
  .strictObject({
    v: z.literal(TICKET_VERSION),
    nonce: z.uuid(),
    seed: z.string().regex(/^[0-9a-f]{32}$/),
    language: z.enum(['en', 'pt']),
    pack: z.enum(PACK_IDS),
    mode: z.enum(['time', 'words']),
    amount: z.number().int(),
    scorer: z.number().int().positive(),
    iat: z.number().int().nonnegative(),
    exp: z.number().int().nonnegative(),
    day: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .refine((t) => PACKS[t.pack].language === t.language, 'pack is in another language')
  .refine((t) => (t.mode === 'time' ? isAmount(TIME_SECONDS, t.amount) : isAmount(WORD_COUNTS, t.amount)), 'no such mode')
  .refine((t) => t.exp > t.iat, 'expires before issue');

export type Ticket = z.infer<typeof ticketSchema>;

function isAmount(allowed: readonly number[], amount: number): boolean {
  return allowed.includes(amount);
}

const stampSchema = z.strictObject({
  nonce: z.uuid(),
  phase: z.enum(['start', 'end']),
  ms: z.number().int().nonnegative(),
});

export type StampPhase = z.infer<typeof stampSchema>['phase'];

export type TicketFailure = 'malformed' | 'unknown-key' | 'bad-signature' | 'bad-payload' | 'expired';
export type TicketCheck = { ok: true; ticket: Ticket } | { ok: false; reason: TicketFailure };

export class TicketConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TicketConfigError';
  }
}

interface KeyRing {
  raw: string;
  signing: { kid: string; secret: string };
  byKid: ReadonlyMap<string, string>;
}

let ring: KeyRing | undefined;

/** TICKET_SECRETS is kid:secret pairs split by commas. The first one signs, the rest still verify while they rotate out. */
function keys(): KeyRing {
  const raw = process.env.TICKET_SECRETS ?? '';
  if (ring?.raw === raw) return ring;
  if (raw === '') throw new TicketConfigError('TICKET_SECRETS is not set');
  const byKid = new Map<string, string>();
  let signing: KeyRing['signing'] | undefined;
  for (const pair of raw.split(',')) {
    const at = pair.indexOf(':');
    const kid = pair.slice(0, at).trim();
    const secret = pair.slice(at + 1).trim();
    if (at < 1 || !KID.test(kid) || secret.length < MIN_SECRET_CHARS || byKid.has(kid)) {
      // Names no value from the variable, because this message reaches logs.
      throw new TicketConfigError('TICKET_SECRETS must be kid:secret pairs with secrets of at least 32 characters');
    }
    byKid.set(kid, secret);
    signing ??= { kid, secret };
  }
  if (!signing) throw new TicketConfigError('TICKET_SECRETS has no keys');
  ring = { raw, signing, byKid };
  return ring;
}

function macOf(domain: Domain, kid: string, payload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(`${domain}.${kid}.${payload}`).digest();
}

function seal(domain: Domain, value: unknown): string {
  const { kid, secret } = keys().signing;
  const payload = Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  return `${kid}.${payload}.${macOf(domain, kid, payload, secret).toString('base64url')}`;
}

type Opened = { ok: true; json: unknown } | { ok: false; reason: 'malformed' | 'unknown-key' | 'bad-signature' | 'bad-payload' };

/** The MAC covers the token's own bytes, so nothing is parsed or re-serialized before it is checked. */
function open(domain: Domain, token: unknown): Opened {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_CHARS) return { ok: false, reason: 'malformed' };
  const [kid, payload, mac, ...rest] = token.split('.');
  if (kid === undefined || payload === undefined || mac === undefined || rest.length > 0) return { ok: false, reason: 'malformed' };
  if (!KID.test(kid) || !BASE64URL.test(payload) || !BASE64URL.test(mac)) return { ok: false, reason: 'malformed' };
  const given = Buffer.from(mac, 'base64url');
  // Buffer ignores a final character's spare bits, and those flips must not verify.
  if (given.length !== MAC_BYTES || given.toString('base64url') !== mac) return { ok: false, reason: 'malformed' };
  const secret = keys().byKid.get(kid);
  if (secret === undefined) return { ok: false, reason: 'unknown-key' };
  if (!timingSafeEqual(given, macOf(domain, kid, payload, secret))) return { ok: false, reason: 'bad-signature' };
  try {
    return { ok: true, json: JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) };
  } catch {
    return { ok: false, reason: 'bad-payload' };
  }
}

export interface TicketRequest {
  language: Language;
  pack: PackId;
  mode: 'time' | 'words';
  amount: number;
  /** The daily seed, for a reveal. Free runs draw a fresh one. */
  seed?: string;
  nonce?: string;
  day?: string;
}

export interface IssuedTicket {
  token: string;
  ticket: Ticket;
}

/** Stateless and with no user inside: the user is bound at submit, so a signed-out page can fetch nothing and a first signed-in run still ranks. */
export function issueTicket(request: TicketRequest, now: number): IssuedTicket {
  const ticket = ticketSchema.parse({
    v: TICKET_VERSION,
    nonce: request.nonce ?? randomUUID(),
    seed: request.seed ?? randomBytes(16).toString('hex'),
    language: request.language,
    pack: request.pack,
    mode: request.mode,
    amount: request.amount,
    scorer: SCORER_VERSION,
    iat: now,
    exp: now + TICKET_TTL_MS,
    ...(request.day === undefined ? {} : { day: request.day }),
  });
  return { token: seal('ticket', ticket), ticket };
}

/** Signature and shape only. Expiry is the caller's to judge, since a retried run may arrive long after a timely start. */
export function readTicket(token: unknown): TicketCheck {
  const opened = open('ticket', token);
  if (!opened.ok) return opened;
  const parsed = ticketSchema.safeParse(opened.json);
  return parsed.success ? { ok: true, ticket: parsed.data } : { ok: false, reason: 'bad-payload' };
}

export function verifyTicket(token: unknown, now: number): TicketCheck {
  const check = readTicket(token);
  if (check.ok && now > check.ticket.exp) return { ok: false, reason: 'expired' };
  return check;
}

/**
 * The fire-and-forget endpoints: no database, no state. A start stamp needs a live ticket, so a start stamp is the proof
 * that the ticket was still valid when the run began. An end stamp needs only a genuine one, because the run may have
 * begun just before expiry. Null means the caller answers 4xx and the client carries on without a stamp.
 */
export function issueStamp(ticketToken: unknown, phase: StampPhase, now: number): string | null {
  const check = phase === 'start' ? verifyTicket(ticketToken, now) : readTicket(ticketToken);
  if (!check.ok) return null;
  return seal('stamp', { nonce: check.ticket.nonce, phase, ms: now });
}

/** The server's clock reading, or null for anything else. A forged stamp earns nothing that no stamp would. */
export function verifyStamp(token: unknown, nonce: string, phase: StampPhase): number | null {
  const opened = open('stamp', token);
  if (!opened.ok) return null;
  const parsed = stampSchema.safeParse(opened.json);
  if (!parsed.success || parsed.data.nonce !== nonce || parsed.data.phase !== phase) return null;
  return parsed.data.ms;
}
