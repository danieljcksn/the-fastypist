import { z } from "zod";
import { issueStamp } from "@/server/tickets";
import { json, problem, readJson, route } from "../_lib/http";

const schema = z.strictObject({ token: z.string().max(2048), phase: z.enum(["start", "end"]) });

/** Holding a ticket is the whole of the check. Clerk may not have loaded yet when a run starts, and this waits for nothing. */
export const POST = route(async (request) => {
  const body = await readJson(request, schema);
  if (!body) return problem("bad-request", 400);
  const stamp = issueStamp(body.token, body.phase, Date.now());
  return stamp === null ? problem("bad-ticket", 400) : json({ stamp });
});
