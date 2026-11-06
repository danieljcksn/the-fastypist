import { encodeLog } from "@/engine/log";
import { encodeSubmission } from "@/server/frame";
import type { RunOutcome } from "../contract";
import { readAccount } from "./account";
import { currentAuth, whenAuthed } from "./auth";
import { setVerdict, type VerdictState } from "./pool";
import type { Verdict } from "./wire";

const KEY = "fastypist:outbox";
const MAX_ENTRIES = 50;
const MAX_AGE_MS = 30 * 86_400_000;
// Stamps are fire and forget, so a slow one may simply not make it. A run with no stamp is judged as having none, which is fine below the gate.
const STAMP_WAIT_MS = 3_000;
const AUTH_WAIT_MS = 20_000;
const TOKEN_ATTEMPTS = 3;
const TOKEN_BACKOFF_MS = 1_000;
const RETRY_MS = 60_000;

interface Entry {
  id: string;
  /** Whose run this is. The body names no user, so without this the next person to sign in on this browser would inherit it. */
  uid: string | null;
  body: string;
  at: number;
}

function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

let memory: Entry[] | null = null;

function load(): Entry[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    const list = Array.isArray(raw) ? (raw as Entry[]) : [];
    return list.filter((entry) => typeof entry?.body === "string" && entry.at > Date.now() - MAX_AGE_MS);
  } catch {
    return memory ?? [];
  }
}

function save(list: Entry[]): void {
  memory = list;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage is full or refused: the page's own copy still retries until it closes.
  }
}

function settled<T>(promise: Promise<T> | null, ms: number, fallback: T): Promise<T> {
  if (promise === null) return Promise.resolve(fallback);
  return Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

/** Called once per run, after paint. The number on screen is already the replay's, so nothing here can change or hold up the result. */
export async function queueRun(outcome: RunOutcome): Promise<void> {
  const flight = outcome.flight;
  if (!flight) return;
  const [start, end] = await Promise.all([settled(flight.start, STAMP_WAIT_MS, null), settled(flight.end, STAMP_WAIT_MS, null)]);
  const body = encodeSubmission(
    {
      ticket: flight.ticket.token,
      start,
      end,
      device: outcome.deviceClass,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      confirms: flight.confirms,
    },
    encodeLog(outcome.entries),
  );
  const entry: Entry = { id: outcome.id, uid: readAccount()?.uid ?? currentAuth()?.userId ?? null, body: toBase64(body), at: Date.now() };
  save([...load().filter((e) => e.id !== entry.id), entry].slice(-MAX_ENTRIES));
  await drain(AUTH_WAIT_MS);
}

type Sent = { kind: "done"; verdict: VerdictState } | { kind: "drop"; verdict: VerdictState } | { kind: "wait"; retryMs: number } | { kind: "auth" };

async function send(entry: Entry, token: string): Promise<Sent> {
  let response: Response;
  try {
    response = await fetch("/api/results", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
      body: fromBase64(entry.body),
    });
  } catch {
    return { kind: "wait", retryMs: RETRY_MS };
  }
  if (response.status === 401) return { kind: "auth" };
  if (response.ok) {
    const answer = (await response.json().catch(() => null)) as { verdict?: Verdict; released?: string | null } | null;
    return answer?.verdict
      ? { kind: "done", verdict: { ...answer.verdict, released: Boolean(answer.released) } }
      : { kind: "done", verdict: { state: "unranked", why: "other", released: false } };
  }
  if (response.status === 429 || response.status >= 500) {
    const after = Number(response.headers.get("Retry-After"));
    return { kind: "wait", retryMs: Number.isFinite(after) && after > 0 ? after * 1000 : RETRY_MS };
  }
  // The server read it and refused it. Sending the same bytes again can't change that answer.
  return { kind: "drop", verdict: { state: "refused" } };
}

let draining = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function retryLater(ms: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void drain(0);
  }, ms);
}

/** One at a time and oldest first. Nothing awaits this, so a restart never waits on it. */
export async function drain(authWaitMs = 0): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    const auth = await whenAuthed(authWaitMs);
    const pending = load();
    if (!auth) {
      for (const entry of pending) setVerdict(entry.id, { state: "unsent" });
      return;
    }
    for (const entry of pending) {
      if (entry.uid !== null && entry.uid !== auth.userId) continue;
      let outcome: Sent = { kind: "auth" };
      for (let attempt = 0; attempt < TOKEN_ATTEMPTS && outcome.kind === "auth"; attempt++) {
        if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, TOKEN_BACKOFF_MS * attempt));
        const token = await auth.getToken(attempt > 0).catch(() => null);
        if (token) outcome = await send(entry, token);
      }
      if (outcome.kind === "auth" || outcome.kind === "wait") {
        for (const left of load()) if (left.uid === null || left.uid === auth.userId) setVerdict(left.id, { state: "unsent" });
        retryLater(outcome.kind === "wait" ? outcome.retryMs : RETRY_MS);
        return;
      }
      save(load().filter((e) => e.id !== entry.id));
      setVerdict(entry.id, outcome.verdict);
    }
  } finally {
    draining = false;
  }
}

let listening = false;

/** Started with the signed-in chunk. Runs left over from an earlier visit go out from here. */
export function watchOutbox(): void {
  if (!listening) {
    listening = true;
    window.addEventListener("online", () => void drain(0));
  }
  void drain(0);
}
