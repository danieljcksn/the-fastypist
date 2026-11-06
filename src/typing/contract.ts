import type { Config, LogEntry } from "@/engine/core";
import type { Language, PackId } from "@/engine/packs";
import type { ModeSpec } from "@/engine/presets";
import type { Score } from "@/engine/score";

export type DeviceClass = "keyboard" | "touch";

/** Mean time per pair before a drill, in ms. A count of 0 means there is no earlier figure. */
export interface PairBaseline {
  meanMs: number;
  count: number;
}

export interface DrillInfo {
  pairs: readonly string[];
  before: Readonly<Record<string, PairBaseline>>;
}

/** A drill ready to type: its words come from make, so a session never loads the analysis it was built with. */
export interface DrillPlan extends DrillInfo {
  make(seed: string): string[];
}

/** What a finished run hands to the results stage. The score is replay's, never the live state's. */
export interface RunOutcome {
  id: string;
  finishedAt: number;
  mode: ModeSpec;
  language: Language;
  /** Null for quote and custom text. */
  packId: PackId | null;
  /** Null unless the text was a quote. */
  quoteId: string | null;
  punctuation: boolean;
  numbers: boolean;
  accentFree: boolean;
  seed: string;
  wordsCount: number;
  words: readonly string[];
  entries: readonly LogEntry[];
  score: Score;
  config: Config;
  deviceClass: DeviceClass;
  afkMs: number;
  /** YYYY-MM-DD where the typist is, for the calendar. */
  localDay: string;
  /** Null for a normal test. A drill is never ranked and sets no personal best. */
  drill: DrillInfo | null;
}
