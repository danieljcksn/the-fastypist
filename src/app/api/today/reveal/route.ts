import { z } from "zod";
import { getDb } from "@/db/client";
import { revealToday } from "@/server/ranking";
import { authed, json, problem, readJson } from "../../_lib/http";

const schema = z.strictObject({ language: z.enum(["en", "pt"]) });

/** Spends today's attempt: the seed only leaves in the response to the insert that took the row. */
export const POST = authed(async (request, { userId }) => {
  const body = await readJson(request, schema);
  if (!body) return problem("bad-request", 400);
  const outcome = await revealToday(getDb(), { clerkUserId: userId, language: body.language, now: Date.now() });
  if (outcome.status === "not-eligible") return json({ error: "not-eligible", missing: outcome.missing }, 403);
  if (outcome.status === "spent") return json({ error: "spent", day: outcome.day, finished: outcome.finished }, 409);
  const { token, ticket } = outcome.issued;
  return json({ day: outcome.day, token, nonce: ticket.nonce, seed: ticket.seed, pack: ticket.pack, mode: ticket.mode, amount: ticket.amount, exp: ticket.exp });
});
