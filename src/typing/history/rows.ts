import { type Language, type PackId, isPackId, RANKED_PACK } from "@/engine/packs";

export const HISTORY_KEY = "fastypist:history";
export const BESTS_KEY = "fastypist:bests";
export const HISTORY_VERSION = 1;
export const MAX_ROWS = 500;

const MODES = ["time", "words", "quote", "custom"] as const;
const MIN_PACE_ACCURACY_BP = 8_500;

export type RowMode = (typeof MODES)[number];

/** One finished run. Local, unverified, and shaped so an account can import it later. */
export interface HistoryRow {
  id: string;
  /** A drill is typing practice: it counts as time typed and for nothing else. */
  kind: "free" | "drill";
  status: "unverified";
  mode: RowMode;
  /** Seconds in time mode, words otherwise. */
  amount: number;
  language: Language;
  pack: PackId | null;
  /** "p", "n" and "a" for punctuation, numbers and accent-free, in that order. A different text, so a different best. */
  mods: string;
  wpmCx: number;
  rawCx: number;
  accuracyBp: number;
  consistencyBp: number | null;
  elapsedMs: number;
  afkMs: number;
  finishedAt: number;
  localDay: string;
  device: "keyboard" | "touch";
}

export interface Best {
  id: string;
  wpmCx: number;
  accuracyBp: number;
  finishedAt: number;
}

export type Bests = Record<string, Best>;

const whole = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** Whatever was stored may have been written by an older build or edited by hand, so nothing is assumed. */
export function parseRow(raw: unknown): HistoryRow | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id.length === 0) return null;
  if (r.kind !== "free" && r.kind !== "drill") return null;
  if (!MODES.includes(r.mode as RowMode)) return null;
  if (r.language !== "en" && r.language !== "pt") return null;
  if (r.pack !== null && !(typeof r.pack === "string" && isPackId(r.pack))) return null;
  if (typeof r.mods !== "string" || typeof r.localDay !== "string") return null;
  if (!whole(r.amount) || !whole(r.wpmCx) || !whole(r.rawCx) || !whole(r.accuracyBp) || !whole(r.elapsedMs) || !whole(r.afkMs) || !whole(r.finishedAt)) return null;
  if (r.consistencyBp !== null && !whole(r.consistencyBp)) return null;
  return {
    id: r.id,
    kind: r.kind,
    status: "unverified",
    mode: r.mode as RowMode,
    amount: r.amount,
    language: r.language,
    pack: r.pack as PackId | null,
    mods: r.mods,
    wpmCx: r.wpmCx,
    rawCx: r.rawCx,
    accuracyBp: r.accuracyBp,
    consistencyBp: r.consistencyBp as number | null,
    elapsedMs: r.elapsedMs,
    afkMs: r.afkMs,
    finishedAt: r.finishedAt,
    localDay: r.localDay,
    device: r.device === "touch" ? "touch" : "keyboard",
  };
}

/** Oldest first, one row per id, at most MAX_ROWS. A corrupt store loses its bad rows, never the test. */
export function parseRows(stored: string | null): HistoryRow[] {
  if (stored === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const { v, rows } = parsed as { v?: unknown; rows?: unknown };
  if (v !== HISTORY_VERSION || !Array.isArray(rows)) return [];
  const byId = new Map<string, HistoryRow>();
  for (const raw of rows) {
    const row = parseRow(raw);
    if (row) byId.set(row.id, row);
  }
  return [...byId.values()].sort((a, b) => a.finishedAt - b.finishedAt).slice(-MAX_ROWS);
}

export function parseBests(stored: string | null): Bests {
  if (stored === null) return {};
  try {
    const parsed = JSON.parse(stored) as { v?: unknown; bests?: unknown };
    if (parsed.v !== HISTORY_VERSION || typeof parsed.bests !== "object" || parsed.bests === null) return {};
    const out: Bests = {};
    for (const [key, raw] of Object.entries(parsed.bests)) {
      const b = raw as Partial<Best> | null;
      if (b && typeof b.id === "string" && whole(b.wpmCx) && whole(b.accuracyBp) && whole(b.finishedAt)) {
        out[key] = { id: b.id, wpmCx: b.wpmCx, accuracyBp: b.accuracyBp, finishedAt: b.finishedAt };
      }
    }
    return out;
  } catch {
    return {};
  }
}

export interface BestScope {
  mode: RowMode;
  amount: number;
  language: Language;
  pack: PackId | null;
  mods: string;
}

/** Per mode, language and list. Quotes differ in length, so they share one key per language. Your own text compares to nothing. */
export function bestKey(scope: BestScope): string | null {
  if (scope.mode === "custom") return null;
  const amount = scope.mode === "quote" ? 0 : scope.amount;
  return `${scope.mode}:${amount}|${scope.language}|${scope.pack ?? ""}|${scope.mods}`;
}

export function beats(run: { wpmCx: number; accuracyBp: number }, best: { wpmCx: number; accuracyBp: number }): boolean {
  return run.wpmCx > best.wpmCx || (run.wpmCx === best.wpmCx && run.accuracyBp > best.accuracyBp);
}

/** A row that can hold a best at all. Drills never do, and a 0 wpm run isn't a best at anything. */
export function bestKeyOf(row: HistoryRow): string | null {
  return row.kind === "free" && row.wpmCx > 0 ? bestKey(row) : null;
}

/** Keeps every stored best and raises it from the rows, so a lost bests entry heals and an evicted row's best survives. */
export function raiseBests(stored: Bests, rows: readonly HistoryRow[]): Bests {
  const out: Bests = { ...stored };
  for (const row of rows) {
    const key = bestKeyOf(row);
    if (key === null) continue;
    const current = out[key];
    if (!current || beats(row, current)) out[key] = { id: row.id, wpmCx: row.wpmCx, accuracyBp: row.accuracyBp, finishedAt: row.finishedAt };
  }
  return out;
}

/** The runs Pace reads: the ranked shape, 60 s on the frozen 1k list at 85% accuracy or better, whether or not anyone signed in. */
export function countsForPace(row: HistoryRow): boolean {
  return (
    row.kind === "free" &&
    row.mode === "time" &&
    row.amount === 60 &&
    row.pack === RANKED_PACK[row.language] &&
    row.mods === "" &&
    row.wpmCx > 0 &&
    row.accuracyBp >= MIN_PACE_ACCURACY_BP
  );
}

/** What the server's import takes. Drills stay on the device: the account's history is a record of tests. */
export function importRow(row: HistoryRow): {
  id: string;
  pack: PackId | null;
  mode: "time" | "words";
  amount: number;
  wpmCx: number;
  rawCx: number;
  accuracyBp: number;
  consistencyBp: number | null;
  elapsedMs: number;
  finishedAt: string;
  localDay: string;
} | null {
  if (row.kind !== "free") return null;
  return {
    id: row.id,
    pack: row.pack,
    mode: row.mode === "time" ? "time" : "words",
    amount: row.amount,
    wpmCx: row.wpmCx,
    rawCx: row.rawCx,
    accuracyBp: row.accuracyBp,
    consistencyBp: row.consistencyBp,
    elapsedMs: row.elapsedMs,
    finishedAt: new Date(row.finishedAt).toISOString(),
    localDay: row.localDay,
  };
}
