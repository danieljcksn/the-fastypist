import { getDb } from "@/db/client";
import { findProfile } from "@/server/accounts";
import { MAX_BODY_BYTES, failedGates, prepareSubmission, readCapped } from "@/server/verify";
import { submitRun, type SubmitOutcome } from "@/server/ranking";
import type { UnrankedWhy, Verdict } from "@/typing/ranked/wire";
import { authed, json, problem } from "../_lib/http";
import { refreshPublicPages } from "../_lib/refresh";

type Recorded = Extract<SubmitOutcome, { status: "recorded" }>;

/** The first gate that failed, in the order a typist can act on. A held run says nothing about which check held it. */
async function verdictOf(outcome: Recorded, clerkUserId: string, body: Uint8Array): Promise<Verdict> {
  const { result } = outcome;
  if (result.ranked) return { state: "ranked" };
  if (result.status === "held") return { state: "checking", id: result.id };
  if (result.status === "voided") return { state: "unranked", why: "voided" };
  if (result.status === "unverified") return { state: "unranked", why: "timing" };
  const prepared = prepareSubmission(body);
  const profile = await findProfile(getDb(), clerkUserId);
  if (!prepared.ok || !profile) return { state: "unranked", why: "other" };
  const { ticket, meta } = prepared.prepared;
  const failed = failedGates({ ticket, score: { accuracyBp: result.accuracyBp }, device: meta.device }, profile);
  return { state: "unranked", why: (failed[0] as UnrankedWhy | undefined) ?? "other" };
}

export const POST = authed(async (request, { userId }) => {
  const body = await readCapped(request.body, MAX_BODY_BYTES);
  if (body === null) return problem("too-large", 413);
  const outcome = await submitRun(getDb(), { clerkUserId: userId, body, now: Date.now() });
  if (outcome.status === "rate-limited") return json({ error: "rate-limited" }, 429, { "Retry-After": "3600" });
  if (outcome.status === "rejected") return problem(outcome.reason, outcome.reason === "too-large" ? 413 : 400);
  if (outcome.result.ranked && !outcome.retried) refreshPublicPages();
  return json({
    id: outcome.result.id,
    verdict: await verdictOf(outcome, userId, body),
    retried: outcome.retried,
    wpmCx: outcome.result.wpmCx,
    accuracyBp: outcome.result.accuracyBp,
    personalBest: outcome.personalBest,
    pace: outcome.pace,
    today: outcome.today,
    released: outcome.released,
  });
});
