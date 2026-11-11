import { z } from "zod";
import { getDb } from "@/db/client";
import { challengeDay } from "@/engine/day";
import { findProfile } from "@/server/accounts";
import { rankedListId, yourToday } from "@/server/ranking";
import { authed, json, problem } from "../../_lib/http";

const language = z.enum(["en", "pt"]);

/** Your row on today's board, which the cached page can't hold. Null until you have finished today's run. */
export const GET = authed(async (request, { userId }) => {
  const parsed = language.safeParse(new URL(request.url).searchParams.get("language"));
  if (!parsed.success) return problem("bad-request", 400);
  const db = getDb();
  const day = challengeDay(Date.now());
  const profile = await findProfile(db, userId);
  if (!profile?.username) return json({ day, username: null, place: null });
  const place = await yourToday(db, { clerkUserId: userId, day, listId: rankedListId(parsed.data) });
  return json({ day, username: profile.username, place });
});
