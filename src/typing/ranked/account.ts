import { signedInCookie } from "./pool";

// Read before Clerk has loaded, so a returning typist's name is in the header with no network at all.

export const ACCOUNT_KEY = "fastypist:account";

export interface CachedAccount {
  uid: string;
  username: string | null;
  consent: boolean;
  listed: boolean;
  at: number;
}

let snapshot: CachedAccount | null | undefined;
let raw: string | null | undefined;
const listeners = new Set<() => void>();

export function readAccount(): CachedAccount | null {
  let next: string | null = null;
  try {
    next = localStorage.getItem(ACCOUNT_KEY);
  } catch {
    return snapshot ?? null;
  }
  if (snapshot !== undefined && next === raw) return snapshot;
  raw = next;
  try {
    const parsed: unknown = next === null ? null : JSON.parse(next);
    snapshot = typeof parsed === "object" && parsed !== null && "uid" in parsed ? (parsed as CachedAccount) : null;
  } catch {
    snapshot = null;
  }
  return snapshot;
}

export function writeAccount(account: CachedAccount | null): void {
  snapshot = account;
  try {
    if (account === null) localStorage.removeItem(ACCOUNT_KEY);
    else localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
    raw = localStorage.getItem(ACCOUNT_KEY);
  } catch {
    // Kept in memory for this page.
  }
  for (const listener of listeners) listener();
}

export function subscribeAccount(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export type HeaderIdentity = { signedIn: false } | { signedIn: true; name: string | null };

const GUEST: HeaderIdentity = { signedIn: false };
const named = new Map<string | null, HeaderIdentity>();

/** Stable objects, because this backs useSyncExternalStore. */
export function headerIdentity(): HeaderIdentity {
  if (!signedInCookie()) return GUEST;
  const name = readAccount()?.username ?? null;
  let identity = named.get(name);
  if (!identity) {
    identity = { signedIn: true, name };
    named.set(name, identity);
  }
  return identity;
}

export const serverIdentity = (): HeaderIdentity => GUEST;

// Fixes the header's box before first paint, from the name it will show, so that nothing beside it moves when hydration fills it in.
export const ACCOUNT_PREPAINT = `try{if(/(?:^|;\\s*)__client_uat(?:_[^=]*)?=[1-9]/.test(document.cookie)){var a=null;try{a=JSON.parse(localStorage.getItem("${ACCOUNT_KEY}"))}catch(e){}var n=a&&a.username?a.username.length:7,r=document.documentElement;r.dataset.account="";r.style.setProperty("--account-w",Math.max(n,7)+1+"ch")}}catch(e){}`;
