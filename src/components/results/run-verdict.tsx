"use client";

import { useState, useSyncExternalStore } from "react";
import { sendReport } from "@/components/boards/report-link";
import { accountStrings } from "@/i18n/account";
import { boardStrings } from "@/i18n/boards";
import type { Lang } from "@/i18n";
import { confirmNextRun, subscribeVerdicts, verdictOf } from "@/typing/ranked/pool";
import type { HomeStore } from "@/typing/store";
import "./verdict.css";

/** The number on screen stays the replay's own either way: this line only says what the server made of it. */
export function RunVerdict({ id, lang, store }: { id: string; lang: Lang; store: HomeStore }) {
  const verdict = useSyncExternalStore(
    subscribeVerdicts,
    () => verdictOf(id),
    () => verdictOf(id),
  );
  const s = accountStrings(lang).verdict;
  const r = boardStrings(lang).report;
  const [review, setReview] = useState<"idle" | "busy" | "sent" | "failed">("idle");
  let line: string | null = null;
  if (verdict.state === "ranked") line = verdict.released ? s.rankedReleased : s.ranked;
  else if (verdict.state === "checking") line = s.checking;
  else if (verdict.state === "unranked") line = s.why[verdict.why];
  else if (verdict.state === "unsent") line = s.unsent;
  else if (verdict.state === "refused") line = s.refused;
  return (
    <span className="rs-verdict" data-testid="verdict" data-state={verdict.state} aria-live="polite">
      {line}
      {verdict.state === "checking" ? (
        <>
          {" "}
          <button
            type="button"
            onClick={() => {
              confirmNextRun(verdict.id);
              store.session?.newWords();
            }}
          >
            {s.retype}
          </button>{" "}
          {review === "sent" || review === "failed" ? (
            <span>{review === "sent" ? r.reviewSent : r.failed}</span>
          ) : (
            <button
              type="button"
              disabled={review === "busy"}
              onClick={() => {
                setReview("busy");
                // An appeal is a report on your own run. Already asked counts as asked.
                void sendReport({ target: "appeal", resultId: verdict.id }).then((sent) => setReview(sent === "sent" || sent === "duplicate" ? "sent" : "failed"));
              }}
            >
              {r.requestReview}
            </button>
          )}
        </>
      ) : null}
    </span>
  );
}
