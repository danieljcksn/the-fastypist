import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { deleteAccount } from "@/server/accounts";
import { ACCOUNTS } from "@/lib/accounts-flag";
import { json, problem, route } from "../../_lib/http";
import { refreshPublicPages } from "../../_lib/refresh";

/**
 * Delivery is neither guaranteed nor ordered, so the weekly reconcile backs this up and a replay must be harmless. Only a
 * delete does anything: the row holds no Clerk field to update, and an update must never insert one.
 */
export const POST = route(async (request) => {
  if (!ACCOUNTS) return problem("accounts-off", 404);
  let event;
  try {
    event = await verifyWebhook(request as NextRequest);
  } catch {
    return problem("bad-signature", 400);
  }
  if (event.type === "user.deleted" && event.data.id) {
    await deleteAccount(getDb(), event.data.id, new Date());
    refreshPublicPages();
  }
  return json({ ok: true });
});
