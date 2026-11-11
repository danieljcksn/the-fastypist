import { paceOf } from "@/engine/analysis";
import { PACE_LISTED_RUNS, PACE_WINDOW_RUNS } from "@/server/standing";

export interface PacePoint {
  t: number;
  pace: number;
}

/** Pace after each ranked run in the window, from the tenth on: the same p80 of the last 25 the ladder keeps. */
export function paceHistory(runs: readonly { t: number; wpmCx: number }[]): PacePoint[] {
  const out: PacePoint[] = [];
  for (let i = PACE_LISTED_RUNS - 1; i < runs.length; i++) {
    const window = runs.slice(Math.max(0, i + 1 - PACE_WINDOW_RUNS), i + 1).map((r) => r.wpmCx);
    const pace = paceOf(window);
    const run = runs[i];
    if (pace !== null && run) out.push({ t: run.t, pace: Math.round(pace) / 100 });
  }
  return out;
}
