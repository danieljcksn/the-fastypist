import { revalidateTag } from "next/cache";
import { BOARDS_TAG, PROFILES_TAG } from "@/server/cache-tags";

/** After the write has committed, so it can't lose a run: a board a little stale until the hourly timer is the worst outcome. */
export function refreshPublicPages(): void {
  try {
    revalidateTag(BOARDS_TAG, "max");
    revalidateTag(PROFILES_TAG, "max");
  } catch (error) {
    console.error("revalidate failed", error instanceof Error ? error.message : "unknown");
  }
}
