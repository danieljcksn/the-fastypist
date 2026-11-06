import { z } from "zod";
import { getDb } from "@/db/client";
import { optIntoRanking, withdrawRankingConsent } from "@/server/accounts";
import { authed, json, problem, readJson } from "../../_lib/http";
import { refreshPublicPages } from "../../_lib/refresh";

const schema = z.strictObject({ consent: z.literal(true), username: z.string().max(64), listed: z.boolean() });

export const POST = authed(async (request, { userId }) => {
  const body = await readJson(request, schema);
  if (!body) return problem("bad-request", 400);
  const outcome = await optIntoRanking(getDb(), { clerkUserId: userId, username: body.username, listed: body.listed, now: new Date() });
  if (!outcome.ok) return json({ error: outcome.problem }, 422);
  refreshPublicPages();
  return json({ username: outcome.username });
});

/** Stops ranking and erases stored flight times, as the consent text promises. */
export const DELETE = authed(async (_request, { userId }) => {
  await withdrawRankingConsent(getDb(), { clerkUserId: userId, now: new Date() });
  refreshPublicPages();
  return json({ consent: false });
});
