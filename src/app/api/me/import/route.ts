import { z } from "zod";
import { getDb } from "@/db/client";
import { IMPORT_CAP, importHistory } from "@/server/accounts";
import { authed, json, problem, readJson } from "../../_lib/http";

// Twice the cap in rows of about 300 bytes, which importHistory also bounds before it reads any.
const IMPORT_BODY_MAX_BYTES = IMPORT_CAP * 2 * 400;
const schema = z.strictObject({ rows: z.array(z.unknown()) });

export const POST = authed(async (request, { userId }) => {
  const body = await readJson(request, schema, IMPORT_BODY_MAX_BYTES);
  if (!body) return problem("bad-request", 400);
  return json(await importHistory(getDb(), { clerkUserId: userId, rows: body.rows, now: new Date() }));
});
