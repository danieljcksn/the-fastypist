import { z } from "zod";
import { getDb } from "@/db/client";
import { banProfile, dismissReport, forceRename, heldRuns, openReports, releaseHold, voidResult } from "@/server/moderation";
import { adminOnly, json, problem, readJson } from "../_lib/http";
import { refreshPublicPages } from "../_lib/refresh";

const note = z.string().max(280).optional();
const profileId = z.number().int().positive();

const schema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("dismiss"), reportId: z.number().int().positive(), note }),
  z.strictObject({ action: z.literal("release"), resultId: z.uuid(), note }),
  z.strictObject({ action: z.literal("void"), resultId: z.uuid(), note }),
  z.strictObject({ action: z.literal("ban"), profileId, note }),
  z.strictObject({ action: z.literal("rename"), profileId, note }),
]);

export const GET = adminOnly(async () => {
  const db = getDb();
  const [reports, held] = await Promise.all([openReports(db), heldRuns(db)]);
  return json({ reports, held });
});

export const POST = adminOnly(async (request, { userId }) => {
  const body = await readJson(request, schema);
  if (!body) return problem("bad-request", 400);
  const db = getDb();
  const base = { adminClerkId: userId, now: new Date(), ...(body.note === undefined ? {} : { note: body.note }) };
  let done: unknown;
  switch (body.action) {
    case "dismiss":
      done = await dismissReport(db, { ...base, reportId: body.reportId });
      break;
    case "release":
      done = await releaseHold(db, { ...base, resultId: body.resultId });
      break;
    case "void":
      done = await voidResult(db, { ...base, resultId: body.resultId });
      break;
    case "ban":
      done = await banProfile(db, { ...base, profileId: body.profileId });
      break;
    case "rename":
      done = await forceRename(db, { ...base, profileId: body.profileId });
      break;
  }
  if (!done) return problem("not-found", 404);
  refreshPublicPages();
  return json({ done });
});
