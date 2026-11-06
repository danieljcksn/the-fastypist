import type { Config, LogEntry } from "@/engine/core";
import type { Language, PackId } from "@/engine/packs";
import type { ModeSpec } from "@/engine/presets";
import type { Score } from "@/engine/score";

export type DeviceClass = "keyboard" | "touch";

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
  /** Null until the results stage computes it from the entries. */
  consistency: number | null;
}
