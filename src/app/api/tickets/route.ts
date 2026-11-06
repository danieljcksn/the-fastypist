import { authed, json, problem, readJson } from "../_lib/http";
import { z } from "zod";
import { issueFreeTicket } from "@/server/tickets";

const anyObject = z.record(z.string(), z.unknown());

/** Stateless by ruling: no database here, or the first key of a run could wake it. Strict validation lives in issueFreeTicket. */
export const POST = authed(async (request) => {
  const body = await readJson(request, anyObject);
  const issued = body === null ? null : issueFreeTicket(body, Date.now());
  if (!issued) return problem("bad-request", 400);
  const { token, ticket } = issued;
  return json({ token, nonce: ticket.nonce, seed: ticket.seed, pack: ticket.pack, mode: ticket.mode, amount: ticket.amount, exp: ticket.exp });
});
