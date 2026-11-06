import { drillWords, pairsAcrossRuns } from "@/engine/analysis";
import { decodeLog } from "@/engine/log";
import { foldAccents } from "@/engine/generate";
import { type Language, loadPack, type Pack, type PackId } from "@/engine/packs";
import type { DrillPlan, PairBaseline } from "../contract";
import { allRaw, type RawRun } from "./raw";

// Long enough for each of up to 3 pairs to appear about 10 times, and the change needs 5 to be worth reporting.
export const DRILL_WORDS = 30;
const MAX_PAIRS = 3;
const PAIR_QUERY = /^\p{L}\p{L}$/u;

async function listFor(language: Language): Promise<Pack | null> {
  // The largest list, because a rare pair has few words and the drill has to keep finding new ones. The smaller list is the fallback.
  for (const id of [`${language}-5k@1`, `${language}-1k@1`] as PackId[]) {
    try {
      return await loadPack(id);
    } catch {
      // Offline or a stale chunk after a deploy. The next list may already be here.
    }
  }
  return null;
}

/** Null when nothing could be drilled: the list didn't load, or no word on it holds any of the pairs. */
export async function planDrill(
  language: Language,
  accentFree: boolean,
  pairs: readonly string[],
  before: Readonly<Record<string, PairBaseline>>,
): Promise<DrillPlan | null> {
  const pack = await listFor(language);
  if (!pack) return null;
  const list = accentFree ? pack.words.map(foldAccents) : pack.words;
  const make = (seed: string) => drillWords(list, pairs, seed, DRILL_WORDS);
  if (make("0".repeat(32)).length === 0) return null;
  return { pairs, before, make };
}

export function pairsFromQuery(search: string): string[] {
  const raw = new URLSearchParams(search).get("drill") ?? "";
  const out: string[] = [];
  for (const pair of raw.split(",")) {
    if (PAIR_QUERY.test(pair) && !out.includes(pair) && out.length < MAX_PAIRS) out.push(pair);
  }
  return out;
}

function logsOf(raws: readonly RawRun[]) {
  return raws.flatMap((raw) => {
    const entries = decodeLog(raw.log);
    return entries === null ? [] : [{ cfg: raw.cfg, words: raw.words, entries }];
  });
}

/** What the last 50 runs measured for these pairs, for a drill that didn't come straight from a result. */
export async function baselineFromHistory(language: Language, pairs: readonly string[]): Promise<Record<string, PairBaseline>> {
  const raws = (await allRaw()).filter((raw) => raw.language === language && !raw.drill);
  const measured = pairsAcrossRuns(logsOf(raws));
  const before: Record<string, PairBaseline> = {};
  for (const pair of pairs) {
    const found = measured.find((p) => p.pair === pair);
    before[pair] = { meanMs: found?.meanMs ?? 0, count: found?.count ?? 0 };
  }
  return before;
}

export async function planFromQuery(language: Language, accentFree: boolean, search: string): Promise<DrillPlan | null> {
  const pairs = pairsFromQuery(search);
  if (pairs.length === 0) return null;
  return planDrill(language, accentFree, pairs, await baselineFromHistory(language, pairs));
}
