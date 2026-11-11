import { ACCOUNTS } from "@/lib/accounts-flag";
import type { PackId } from "@/engine/packs";
import { packIdFor, type TestSettings } from "../settings";
import type { UnrankedWhy, Verdict } from "./wire";

// In the first load of the page, so this stays small: everything that touches Clerk or builds a body is in a chunk of its own.

const KEY = "fastypist:tickets";
export const POOL_TARGET = 2;
// A ticket about to lapse would make the run unverifiable, and its text is already on screen by then.
const MIN_LIFE_MS = 60_000;
const SIGNED_IN = /(?:^|;\s*)__client_uat(?:_[^=]*)?=([1-9])/;

export type { UnrankedWhy, Verdict };

export interface TicketSpec {
  pack: PackId;
  mode: "time" | "words";
  amount: number;
}

export interface HeldTicket extends TicketSpec {
  token: string;
  nonce: string;
  seed: string;
  exp: number;
}

/** The session cookie is HttpOnly, but this one is readable, and it reads 0 after a sign-out. */
export function signedInCookie(): boolean {
  return ACCOUNTS && SIGNED_IN.test(document.cookie);
}

/** Null for anything a ticket can't describe: a ticket names a list, a mode and a seed, and those alone must rebuild the text. */
export function specFor(settings: TestSettings): TicketSpec | null {
  const { mode } = settings;
  if (settings.punctuation || settings.numbers || (settings.language === "pt" && settings.accentFree)) return null;
  const pack = packIdFor(settings);
  if (mode.kind === "time") return { pack, mode: "time", amount: mode.seconds };
  if (mode.kind === "words") return { pack, mode: "words", amount: mode.count };
  return null;
}

const keyOf = (spec: TicketSpec): string => `${spec.pack}|${spec.mode}|${spec.amount}`;

type Stored = Record<string, HeldTicket[]>;

function read(): Stored {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return typeof raw === "object" && raw !== null ? (raw as Stored) : {};
  } catch {
    return {};
  }
}

function write(pool: Stored): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(pool));
  } catch {
    // Without storage a run stays local, which is complete.
  }
}

const live = (list: HeldTicket[] | undefined): HeldTicket[] => (Array.isArray(list) ? list.filter((t) => t.exp > Date.now() + MIN_LIFE_MS) : []);

/** Spent even if no key follows: a ticket whose text has been shown goes no further than that text. */
export function takeTicket(spec: TicketSpec | null): HeldTicket | null {
  if (spec === null || !signedInCookie()) return null;
  const pool = read();
  const list = live(pool[keyOf(spec)]);
  const ticket = list.shift() ?? null;
  pool[keyOf(spec)] = list;
  write(pool);
  return ticket;
}

export function ticketCount(spec: TicketSpec): number {
  return live(read()[keyOf(spec)]).length;
}

const arrivals = new Set<() => void>();

/** First in line for today's text: the next 60 s run on its list must be that one, whatever tickets were already waiting. */
export function addTicket(ticket: HeldTicket, first = false): void {
  const pool = read();
  const key = keyOf(ticket);
  pool[key] = first ? [ticket, ...live(pool[key])] : [...live(pool[key]), ticket];
  write(pool);
  for (const listener of arrivals) listener();
}

export function clearTickets(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear without storage.
  }
}

export function onTicketArrival(listener: () => void): () => void {
  arrivals.add(listener);
  return () => arrivals.delete(listener);
}

let refill: ((spec: TicketSpec) => void) | null = null;
let wanted: TicketSpec | null = null;

/** Goes nowhere until the signed-in chunk has loaded, which then asks for the last spec it missed. */
export function wantTickets(spec: TicketSpec | null): void {
  wanted = spec;
  if (spec !== null) refill?.(spec);
}

export function connectRefill(next: ((spec: TicketSpec) => void) | null): void {
  refill = next;
  if (next && wanted) next(wanted);
}

export interface Flight {
  ticket: HeldTicket;
  confirms: string | null;
  start: Promise<string | null>;
  end: Promise<string | null> | null;
}

function stamp(token: string, phase: "start" | "end"): Promise<string | null> {
  return fetch("/api/stamps", {
    method: "POST",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, phase }),
  })
    .then((response) => (response.ok ? (response.json() as Promise<{ stamp?: unknown }>) : null))
    .then((body) => (typeof body?.stamp === "string" ? body.stamp : null))
    .catch(() => null);
}

let confirming: string | null = null;

/** The next run retypes this held one. */
export function confirmNextRun(id: string): void {
  confirming = id;
}

export function launch(ticket: HeldTicket): Flight {
  const confirms = confirming;
  confirming = null;
  return { ticket, confirms, start: stamp(ticket.token, "start"), end: null };
}

export function land(flight: Flight): void {
  flight.end = stamp(flight.ticket.token, "end");
}

export type VerdictState =
  | { state: "sending" }
  | { state: "unsent" }
  | { state: "refused" }
  | (Verdict & { released: boolean });

const verdicts = new Map<string, VerdictState>();
const verdictListeners = new Set<() => void>();

export function setVerdict(id: string, value: VerdictState): void {
  verdicts.set(id, value);
  for (const listener of verdictListeners) listener();
}

export function verdictOf(id: string): VerdictState {
  return verdicts.get(id) ?? SENDING;
}

const SENDING: VerdictState = { state: "sending" };

export function subscribeVerdicts(listener: () => void): () => void {
  verdictListeners.add(listener);
  return () => verdictListeners.delete(listener);
}
