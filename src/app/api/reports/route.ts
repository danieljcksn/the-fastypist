import { z } from "zod";
import { getDb } from "@/db/client";
import { NOTE_MAX_CHARS, fileReport } from "@/server/moderation";
import { authed, json, problem, readJson } from "../_lib/http";

const schema = z.strictObject({
  target: z.enum(["username", "result", "appeal"]),
  username: z.string().max(64).optional(),
  resultId: z.string().max(64).optional(),
  note: z.string().max(NOTE_MAX_CHARS * 4).optional(),
});

const STATUS = { "not-found": 404, self: 422, duplicate: 409, "rate-limited": 429, "note-too-long": 422 } as const;

export const POST = authed(async (request, { userId }) => {
  const body = await readJson(request, schema);
  if (!body) return problem("bad-request", 400);
  const outcome = await fileReport(getDb(), { clerkUserId: userId, ...body, now: new Date() });
  return outcome.ok ? json({ id: outcome.id }, 201) : problem(outcome.reason, STATUS[outcome.reason]);
});
