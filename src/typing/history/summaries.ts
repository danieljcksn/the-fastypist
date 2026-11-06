import { BESTS_KEY, type Best, type Bests, bestKeyOf, beats, HISTORY_KEY, HISTORY_VERSION, type HistoryRow, MAX_ROWS, parseBests, parseRows, raiseBests } from "./rows";

export interface HistorySnapshot {
  rows: readonly HistoryRow[];
  bests: Readonly<Bests>;
  /** When this was read, so a screen has one "now" that a prerender can't see and that moves with each run. */
  readAt: number;
}

export const EMPTY_HISTORY: HistorySnapshot = { rows: [], bests: {}, readAt: 0 };

// How much to give back when storage is full. Enough that the next few runs don't each repeat a failing write.
const QUOTA_TRIM = 100;

// Holds the runs when storage is refused, so a private window still has results and bests until the tab closes.
let cached: HistorySnapshot | null = null;
let storageFailed = false;
const listeners = new Set<() => void>();

function read(): HistorySnapshot {
  const rows = parseRows(localStorage.getItem(HISTORY_KEY));
  return { rows, bests: raiseBests(parseBests(localStorage.getItem(BESTS_KEY)), rows), readAt: Date.now() };
}

function write(next: HistorySnapshot): boolean {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify({ v: HISTORY_VERSION, rows: next.rows }));
    localStorage.setItem(BESTS_KEY, JSON.stringify({ v: HISTORY_VERSION, bests: next.bests }));
    return true;
  } catch {
    return false;
  }
}

function notify() {
  for (const listener of listeners) listener();
}

/** A stable object until something changes, so it can back useSyncExternalStore directly. */
export function loadHistory(): HistorySnapshot {
  if (cached) return cached;
  try {
    cached = read();
  } catch {
    storageFailed = true;
    cached = { ...EMPTY_HISTORY, readAt: Date.now() };
  }
  return cached;
}

export function subscribeHistory(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === HISTORY_KEY || e.key === BESTS_KEY || e.key === null) {
      if (!storageFailed) cached = null;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export interface Appended {
  /** The best this run was compared against. Null on the first run of its kind. */
  previous: Best | null;
  isBest: boolean;
}

/** Re-reads first, because another tab may have written since the cache was filled. */
export function appendRow(row: HistoryRow): Appended {
  if (!storageFailed) cached = null;
  const current = loadHistory();
  const key = bestKeyOf(row);
  const previous = key === null ? null : (current.bests[key] ?? null);
  const isBest = key !== null && (previous === null || beats(row, previous));
  const bests: Bests = { ...current.bests };
  if (key !== null && isBest) bests[key] = { id: row.id, wpmCx: row.wpmCx, accuracyBp: row.accuracyBp, finishedAt: row.finishedAt };
  const rows = [...current.rows.filter((r) => r.id !== row.id), row].slice(-MAX_ROWS);
  const readAt = Date.now();
  let next: HistorySnapshot = { rows, bests, readAt };
  if (!storageFailed && !write(next)) {
    const trimmed = { rows: rows.slice(QUOTA_TRIM), bests, readAt };
    if (write(trimmed)) next = trimmed;
    else storageFailed = true;
  }
  cached = next;
  notify();
  return { previous, isBest };
}

/** For tests: forgets what this module holds, as a page load would. */
export function resetHistoryCache() {
  cached = null;
  storageFailed = false;
}
