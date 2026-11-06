import { getDb } from "@/db/client";
import { exportAccount } from "@/server/accounts";
import { authed, json } from "../../_lib/http";

export const GET = authed(async (_request, { userId }) => {
  const data = (await exportAccount(getDb(), userId)) ?? { exportedFormat: 1, profile: null };
  return json(data, 200, { "Content-Disposition": 'attachment; filename="thefastypist-export.json"' });
});
