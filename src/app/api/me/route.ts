import { clerkClient } from "@clerk/nextjs/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { deleteAccount, findProfile } from "@/server/accounts";
import { authed, json, problem, readJson } from "../_lib/http";
import { refreshPublicPages } from "../_lib/refresh";

const deletion = z.strictObject({ confirm: z.literal("delete") });

function hasStatus(error: unknown, status: number): boolean {
  return typeof error === "object" && error !== null && (error as { status?: unknown }).status === status;
}

/** Reads and creates nothing beyond this: the row only appears when a run, a claim or an import needs one. */
export const GET = authed(async (_request, { userId }) => {
  const profile = await findProfile(getDb(), userId);
  return json({
    username: profile?.username ?? null,
    consent: profile?.rankingConsentAt != null,
    listed: profile?.listedAt != null,
    banned: profile?.bannedAt != null,
  });
});

/** The row goes first, because the data is the promise: a failed Clerk call leaves a signed-in empty account and a retry that finishes. */
export const DELETE = authed(async (request, { userId }) => {
  if (!(await readJson(request, deletion))) return problem("bad-request", 400);
  await deleteAccount(getDb(), userId, new Date());
  refreshPublicPages();
  const client = await clerkClient();
  try {
    await client.users.deleteUser(userId);
  } catch (error) {
    if (!hasStatus(error, 404)) throw error;
  }
  return json({ deleted: true });
});
