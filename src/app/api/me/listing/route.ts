import { z } from "zod";
import { getDb } from "@/db/client";
import { setListed } from "@/server/accounts";
import { authed, json, problem, readJson } from "../../_lib/http";
import { refreshPublicPages } from "../../_lib/refresh";

const schema = z.strictObject({ listed: z.boolean() });

export const POST = authed(async (request, { userId }) => {
  const body = await readJson(request, schema);
  if (!body) return problem("bad-request", 400);
  const changed = await setListed(getDb(), { clerkUserId: userId, listed: body.listed, now: new Date() });
  if (!changed) return problem("needs-consent", 409);
  refreshPublicPages();
  return json({ listed: body.listed });
});
