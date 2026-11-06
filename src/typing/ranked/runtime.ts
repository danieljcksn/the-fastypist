import { readAccount, writeAccount } from "./account";
import { type AuthPort, connectAuth } from "./auth";
import { watchOutbox } from "./outbox";
import { addTicket, clearTickets, connectRefill, type HeldTicket, POOL_TARGET, type TicketSpec, ticketCount } from "./pool";

const ACCOUNT_FRESH_MS = 6 * 3_600_000;

let current: AuthPort | null = null;
let filling = false;

function idle(task: () => void) {
  if (typeof requestIdleCallback === "function") requestIdleCallback(task, { timeout: 2_000 });
  else setTimeout(task, 32);
}

async function fetchTicket(auth: AuthPort, spec: TicketSpec): Promise<HeldTicket | null> {
  const token = await auth.getToken(false);
  if (!token) return null;
  const response = await fetch("/api/tickets", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(spec),
  });
  return response.ok ? ((await response.json()) as HeldTicket) : null;
}

async function fill(spec: TicketSpec) {
  if (filling) return;
  filling = true;
  try {
    while (current && readAccount()?.consent && ticketCount(spec) < POOL_TARGET) {
      const ticket = await fetchTicket(current, spec);
      if (!ticket) return;
      addTicket(ticket);
    }
  } catch {
    // Offline or refused: this run stays local, and the next test asks again.
  } finally {
    filling = false;
  }
}

/** On idle and off the key path. A run that starts before this finishes has no ticket and stays local. */
function refill(spec: TicketSpec) {
  idle(() => {
    if (document.documentElement.dataset.typing === undefined) void fill(spec);
  });
}

/** Cached, because every page load for a signed-in typist would otherwise wake the database just to learn what it already knows. */
export async function refreshAccount(auth: AuthPort, force = false): Promise<void> {
  const cached = readAccount();
  if (!force && cached?.uid === auth.userId && Date.now() - cached.at < ACCOUNT_FRESH_MS) return;
  const token = await auth.getToken(false);
  if (!token) return;
  const response = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) return;
  const me = (await response.json()) as { username: string | null; consent: boolean; listed: boolean };
  if (!me.consent) clearTickets();
  writeAccount({ uid: auth.userId, username: me.username, consent: me.consent, listed: me.listed, at: Date.now() });
}

export function connect(auth: AuthPort | null): void {
  current = auth;
  connectAuth(auth);
  if (!auth) {
    connectRefill(null);
    return;
  }
  void refreshAccount(auth)
    .catch(() => undefined)
    .then(() => {
      if (current === auth) connectRefill(refill);
    });
  watchOutbox();
}
