import { z } from "zod";
import { getDb } from "@/db/client";
import { challengeDay } from "@/engine/day";
import { publicSeed } from "@/server/ranking";
import { json, problem, route } from "../_lib/http";

const DAY_MS = 86_400_000;
// A finished day's seed never changes, so only the turn at 06:00 UTC limits this, and a guest a few minutes late still gets a real text.
const SHARED_SECONDS = 300;

const language = z.enum(["en", "pt"]);

/** Public: a finished day is no secret. The CDN answers most of these, so a crowd of guests doesn't wake the database. */
export const GET = route(async (request) => {
  const parsed = language.safeParse(new URL(request.url).searchParams.get("language"));
  if (!parsed.success) return problem("bad-request", 400);
  const now = Date.now();
  const day = challengeDay(now - DAY_MS);
  const found = await publicSeed(getDb(), { day, language: parsed.data, now });
  if (!found) return problem("not-found", 404);
  return json({ day, language: parsed.data, ...found }, 200, { "Cache-Control": `public, s-maxage=${SHARED_SECONDS}, stale-while-revalidate=${SHARED_SECONDS}` });
});
