import type { Config } from "@/engine/core";
import type { Language } from "@/engine/packs";

const DB_NAME = "fastypist";
const STORE = "raw";
const RAW_VERSION = 1;

export const KEEP_RAW_RUNS = 50;

/** The keystrokes of a recent or best run. Raw logs never leave the device. */
export interface RawRun {
  v: number;
  id: string;
  finishedAt: number;
  language: Language;
  /** A drill's log reads the same but never feeds the slowest pairs. */
  drill: boolean;
  cfg: Config;
  words: readonly string[];
  /** encodeLog's bytes, with holds stripped. */
  log: Uint8Array;
}

let opening: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, RAW_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "id" });
      };
      request.onsuccess = () => {
        const db = request.result;
        // Another tab's upgrade must not wait on this connection, and the next call simply opens again.
        db.onversionchange = () => {
          db.close();
          opening = null;
        };
        resolve(db);
      };
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return open().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        try {
          const tx = db.transaction(STORE, mode);
          const request = work(tx.objectStore(STORE));
          tx.oncomplete = () => resolve(request.result);
          tx.onerror = () => resolve(null);
          tx.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

export function getRaw(id: string): Promise<RawRun | null> {
  return run("readonly", (store) => store.get(id) as IDBRequest<RawRun | undefined>).then((found) => found ?? null);
}

export function allRaw(): Promise<RawRun[]> {
  return run("readonly", (store) => store.getAll() as IDBRequest<RawRun[]>).then((found) => found ?? []);
}

/** The newest 50 runs and anything kept for a best stay. Everything else goes. */
export function rawToDrop(held: readonly { id: string; finishedAt: number }[], keep: ReadonlySet<string>): string[] {
  return [...held]
    .sort((a, b) => b.finishedAt - a.finishedAt)
    .slice(KEEP_RAW_RUNS)
    .filter((r) => !keep.has(r.id))
    .map((r) => r.id);
}

export async function putRaw(record: RawRun, keep: ReadonlySet<string>): Promise<void> {
  await run("readwrite", (store) => store.put(record));
  const held = await allRaw();
  const drop = rawToDrop(held, keep);
  if (drop.length === 0) return;
  const db = await open();
  if (!db) return;
  try {
    const store = db.transaction(STORE, "readwrite").objectStore(STORE);
    for (const id of drop) store.delete(id);
  } catch {
    // Nothing depends on pruning succeeding. The next run tries again.
  }
}
