// The shapes the client and the route handlers agree on. Types only, so importing this ships nothing.

export type UnrankedWhy =
  | "no-username"
  | "no-consent"
  | "banned"
  | "list-not-ranked"
  | "not-sixty-seconds"
  | "low-accuracy"
  | "touch-keyboard"
  | "timing"
  | "voided"
  | "other";

export type Verdict = { state: "ranked" } | { state: "checking"; id: string } | { state: "unranked"; why: UnrankedWhy };
