import { z } from "zod";
import { getDb } from "@/db/client";
import { claimUsername, usernameAvailability } from "@/server/accounts";
import { authed, json, problem, readJson } from "../_lib/http";
import { refreshPublicPages } from "../_lib/refresh";

const schema = z.strictObject({ username: z.string().max(64) });

/** Live availability for a signed-in typist, so nobody walks the name space without an account. */
export const GET = authed(async (request, { userId }) => {
  const name = new URL(request.url).searchParams.get("name");
  if (name === null || name.length > 64) return problem("bad-request", 400);
  return json(await usernameAvailability(getDb(), { clerkUserId: userId, username: name, now: new Date() }));
});

export const POST = authed(async (request, { userId }) => {
  const body = await readJson(request, schema);
  if (!body) return problem("bad-request", 400);
  const outcome = await claimUsername(getDb(), { clerkUserId: userId, username: body.username, now: new Date() });
  if (!outcome.ok) return json({ error: outcome.problem }, 422);
  refreshPublicPages();
  return json({ username: outcome.username });
});
