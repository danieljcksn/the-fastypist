import { timingSafeEqual } from "node:crypto";
import { clerkClient } from "@clerk/nextjs/server";
import { getDb } from "@/db/client";
import { reconcile } from "@/server/reconcile";
import { runDailyJob } from "@/server/moderation";
import { ACCOUNTS } from "@/lib/accounts-flag";
import { json, problem, route } from "../../_lib/http";
import { refreshPublicPages } from "../../_lib/refresh";

// Hobby allows one daily schedule per job, so the weekly reconcile rides on the daily one, on Sundays.
const RECONCILE_DAY = 0;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const wanted = Buffer.from(`Bearer ${secret}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

export const GET = route(async (request) => {
  if (!authorized(request)) return problem("forbidden", 401);
  const now = new Date();
  const db = getDb();
  await runDailyJob(db, now);
  const removed = ACCOUNTS && now.getUTCDay() === RECONCILE_DAY ? await reconcile(db, await clerkClient(), now) : 0;
  refreshPublicPages();
  return json({ ok: true, removed });
});
