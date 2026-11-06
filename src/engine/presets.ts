import type { Config } from "./core";

// 4, not MAX_EXTRA: lines wrap 4 columns short of the row, so the cap and the reserve are one number.
const EXTRAS = 4;

export type ModeSpec =
  | { kind: "time"; seconds: number }
  | { kind: "words"; count: number }
  | { kind: "quote" }
  | { kind: "custom" };

export function configFor(mode: ModeSpec): Config {
  return {
    mode: mode.kind === "time" ? "time" : "words",
    durationMs: mode.kind === "time" ? mode.seconds * 1000 : 0,
    stopOn: "none",
    maxExtra: EXTRAS,
    backspace: "incorrect-only",
  };
}

export const RANKED_CONFIG: Readonly<Config> = configFor({ kind: "time", seconds: 60 });
