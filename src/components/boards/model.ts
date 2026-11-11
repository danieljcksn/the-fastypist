import { wpmAtPercentile } from "@/engine/analysis";
import type { BoardRow } from "@/server/ranking";

/** Counts, places out of a total and the strip all wait for this many players: "3 of 3" says more than it should. */
export const COUNT_MIN_PLAYERS = 5;

// The mean Dhakal et al. 2018 published. The two faster rows come from the same curve as every percentile sentence.
const PUBLISHED_AVERAGE_WPM = 51.56;

export type Benchmark = { kind: "average" } | { kind: "faster"; percent: number };

export type Line = { kind: "row"; row: BoardRow } | { kind: "benchmark"; benchmark: Benchmark; wpm: number };

export function benchmarks(): { benchmark: Benchmark; wpm: number }[] {
  return [
    { benchmark: { kind: "faster", percent: 98 }, wpm: Math.round(wpmAtPercentile(98)) },
    { benchmark: { kind: "faster", percent: 90 }, wpm: Math.round(wpmAtPercentile(90)) },
    { benchmark: { kind: "average" }, wpm: Math.round(PUBLISHED_AVERAGE_WPM) },
  ];
}

/**
 * Reference rows in value order among the real ones. Below the last row shown they appear only when that row is the
 * board's last, or they would claim a place among rows on a later page.
 */
export function boardLines(rows: readonly BoardRow[], total: number): Line[] {
  const complete = rows.length >= total;
  const last = rows.at(-1);
  const marks = benchmarks().filter((b) => complete || (last !== undefined && b.wpm * 100 >= last.wpmCx));
  const out: Line[] = [];
  let next = 0;
  for (const row of rows) {
    // A real row at the same speed goes first: the reference is a scale, never a rival.
    while (next < marks.length && (marks[next]?.wpm ?? 0) * 100 > row.wpmCx) {
      const mark = marks[next++];
      if (mark) out.push({ kind: "benchmark", ...mark });
    }
    out.push({ kind: "row", row });
  }
  for (; next < marks.length; next++) {
    const mark = marks[next];
    if (mark) out.push({ kind: "benchmark", ...mark });
  }
  return out;
}

/** "4h 12m" to the next text, never "0h 0m": the last minute still reads as one. */
export function untilNext(ms: number): { h: number; m: number } {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  return { h: Math.floor(minutes / 60), m: minutes % 60 };
}

export const wpmText = (cx: number): string => (cx / 100).toFixed(1);
export const accuracyText = (bp: number): string => `${Math.floor(bp / 100)}%`;

/**
 * The daily share: the day, the speed, accuracy and the place, never a word of the text. The place waits for 5 players,
 * like every other count.
 */
export function shareText(input: {
  day: string;
  wpmCx: number;
  accuracyBp: number;
  rank: number | null;
  total: number;
  url: string;
  lang: "en" | "pt-br";
  ordinal: (n: number) => string;
}): string {
  const wpm = Math.round(input.wpmCx / 100);
  const accuracy = accuracyText(input.accuracyBp);
  const placed = input.rank !== null && input.total >= COUNT_MIN_PLAYERS;
  const head =
    input.lang === "pt-br"
      ? `thefastypist, texto do dia ${input.day}: ${wpm} ppm com ${accuracy} de precisão${placed ? `, ${input.ordinal(input.rank ?? 0)} de ${input.total}` : ""}.`
      : `thefastypist, today's text for ${input.day}: ${wpm} wpm at ${accuracy} accuracy${placed ? `, ${input.ordinal(input.rank ?? 0)} of ${input.total}` : ""}.`;
  return `${head}\n${input.url}`;
}
