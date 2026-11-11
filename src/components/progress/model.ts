import { quantile } from "@/components/charts/scale";
import type { Best, HistoryRow, RowMode } from "@/typing/history/rows";

const DAY_MS = 86_400_000;

export const CALENDAR_WEEKS = 53;

/** Calendar cells step through 0 runs, 1, 2 to 3, 4 to 7, 8 or more. A choice: no data yet says how much people type in a day. */
export function dayTier(runs: number): 0 | 1 | 2 | 3 | 4 {
  if (runs === 0) return 0;
  if (runs === 1) return 1;
  if (runs <= 3) return 2;
  return runs <= 7 ? 3 : 4;
}

function dayNumber(day: string): number {
  return Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
}

function dayString(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export interface CalendarCell {
  day: string;
  runs: number;
  /** Time at the keyboard that day. */
  ms: number;
  tier: 0 | 1 | 2 | 3 | 4;
}

export interface Calendar {
  /** Column by column from the Sunday 52 weeks back, ending on today, so the last column is usually short. */
  cells: CalendarCell[];
  /** The column each month starts in. */
  months: { column: number; day: string }[];
  daysInYear: number;
  daysInMonth: number;
}

/** Works in UTC on the stored local day strings, so a daylight saving change can't drop or double a cell. */
export function calendarOf(rows: readonly { localDay: string; elapsedMs?: number; afkMs?: number }[], today: string): Calendar {
  const counts = new Map<string, number>();
  const times = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.localDay, (counts.get(row.localDay) ?? 0) + 1);
    times.set(row.localDay, (times.get(row.localDay) ?? 0) + Math.max(0, (row.elapsedMs ?? 0) - (row.afkMs ?? 0)));
  }
  const end = dayNumber(today);
  // Day 0 of the Unix epoch was a Thursday, so (n + 4) % 7 is the weekday with Sunday as 0.
  const start = end - ((end + 4) % 7) - (CALENDAR_WEEKS - 1) * 7;
  const cells: CalendarCell[] = [];
  const months: Calendar["months"] = [];
  let lastMonth = "";
  let daysInYear = 0;
  let daysInMonth = 0;
  for (let n = start; n <= end; n++) {
    const day = dayString(n);
    const runs = counts.get(day) ?? 0;
    cells.push({ day, runs, ms: times.get(day) ?? 0, tier: dayTier(runs) });
    if (runs > 0) {
      if (n > end - 365) daysInYear++;
      if (n > end - 30) daysInMonth++;
    }
    const column = Math.floor((n - start) / 7);
    const month = day.slice(0, 7);
    if (month !== lastMonth && (n - start) % 7 === 0) {
      lastMonth = month;
      months.push({ column, day });
    }
  }
  return { cells, months, daysInYear, daysInMonth };
}

export interface BestRow extends Best {
  key: string;
  mode: RowMode;
  amount: number;
  tier: string | null;
  mods: string;
}

const MODE_ORDER: Readonly<Record<string, number>> = { time: 0, words: 1, quote: 2 };

/** Time, then words, then quotes, shortest first, with the plain list ahead of its variants. */
export function bestRows(bests: Readonly<Record<string, Best>>, language: string): BestRow[] {
  const out: BestRow[] = [];
  for (const [key, best] of Object.entries(bests)) {
    const match = /^(time|words|quote):(\d+)\|(en|pt)\|([^|]*)\|(.*)$/.exec(key);
    if (!match || match[3] !== language) continue;
    const pack = match[4] ?? "";
    out.push({
      ...best,
      key,
      mode: match[1] as RowMode,
      amount: Number(match[2]),
      tier: pack === "" ? null : (/-(200|1k|5k)@/.exec(pack)?.[1] ?? null),
      mods: match[5] ?? "",
    });
  }
  return out.sort(
    (a, b) =>
      (MODE_ORDER[a.mode] ?? 9) - (MODE_ORDER[b.mode] ?? 9) ||
      a.amount - b.amount ||
      Number(a.tier !== "1k") - Number(b.tier !== "1k") ||
      a.mods.localeCompare(b.mods) ||
      a.key.localeCompare(b.key),
  );
}

/** Time actually at the keyboard: a run left idle counts only up to where the typing stopped. */
export function timeTypedMs(rows: readonly HistoryRow[]): number {
  let sum = 0;
  for (const row of rows) sum += Math.max(0, row.elapsedMs - row.afkMs);
  return sum;
}

const RECENT_ACCURACY_RUNS = 25;

export function recentAccuracy(rows: readonly HistoryRow[]): number | null {
  const recent = rows.filter((row) => row.kind === "free").slice(-RECENT_ACCURACY_RUNS);
  if (recent.length === 0) return null;
  let sum = 0;
  for (const row of recent) sum += row.accuracyBp;
  return sum / recent.length / 100;
}

export function languagesOf(rows: readonly HistoryRow[]): ("en" | "pt")[] {
  const seen = new Set(rows.map((row) => row.language));
  return (["en", "pt"] as const).filter((language) => seen.has(language));
}

export interface AccuracyWeek {
  /** The Sunday the bucket starts on, as a day string and as days since the epoch. */
  week: string;
  n: number;
  /** Weeks per bucket, the same for every bucket in a series. */
  span: number;
  runs: number;
  median: number;
  q1: number;
  q3: number;
  low: number;
  high: number;
}

/**
 * Free runs grouped by the weeks they fell in, Sunday first like the calendar, as percent. A long history groups several
 * weeks per point, so there are never more than `most`: a week's median of ten runs moves by more than accuracy really
 * does, and fifty of them side by side read as noise. Buckets with no runs are absent.
 */
export function weeklyAccuracy(rows: readonly HistoryRow[], most = 16): AccuracyWeek[] {
  const starts: { start: number; value: number }[] = [];
  for (const row of rows) {
    if (row.kind !== "free") continue;
    const n = dayNumber(row.localDay);
    if (!Number.isFinite(n)) continue;
    starts.push({ start: n - ((n + 4) % 7), value: row.accuracyBp / 100 });
  }
  if (starts.length === 0) return [];
  let first = Infinity;
  let last = -Infinity;
  for (const { start } of starts) {
    first = Math.min(first, start);
    last = Math.max(last, start);
  }
  const span = Math.max(1, Math.ceil(((last - first) / 7 + 1) / most));
  const buckets = new Map<number, number[]>();
  for (const { start, value } of starts) {
    const key = first + Math.floor((start - first) / (7 * span)) * 7 * span;
    const list = buckets.get(key) ?? [];
    list.push(value);
    buckets.set(key, list);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([n, values]) => {
      const sorted = [...values].sort((x, y) => x - y);
      return { week: dayString(n), n, span, runs: sorted.length, median: quantile(sorted, 0.5), q1: quantile(sorted, 0.25), q3: quantile(sorted, 0.75), low: sorted[0] ?? 0, high: sorted.at(-1) ?? 0 };
    });
}
