import { z } from "zod";
import { getDb } from "@/db/client";
import { wouldHavePlaced } from "@/server/ranking";
import { json, problem, route } from "../../_lib/http";

const schema = z.object({
  day: z.string().max(10),
  language: z.enum(["en", "pt"]),
  wpmCx: z.coerce.number().int(),
  accuracyBp: z.coerce.number().int(),
});

/** "You'd have placed 3rd of 41". The speed is the guest's own claim, and this writes nothing. */
export const GET = route(async (request) => {
  const parsed = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return problem("bad-request", 400);
  return json({ place: await wouldHavePlaced(getDb(), { ...parsed.data, now: Date.now() }) });
});
