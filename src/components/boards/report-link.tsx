"use client";

import { useState, useSyncExternalStore } from "react";
import type { Lang } from "@/i18n";
import { boardStrings } from "@/i18n/boards";
import { whenAuthed } from "@/typing/ranked/auth";
import { signedInCookie } from "@/typing/ranked/pool";

const never = () => () => {};

/** Signed in, from the readable session cookie. False on the server, so the static page holds no control a guest can't use. */
export function useSignedIn(): boolean {
  return useSyncExternalStore(never, signedInCookie, () => false);
}

/** Bearer rather than the cookie: the session cookie may have lapsed by the time someone clicks. */
export async function authedFetch(path: string, init: { method?: string; body?: unknown } = {}): Promise<Response | null> {
  const auth = await whenAuthed(5_000);
  const token = await auth?.getToken(false);
  if (!token) return null;
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  return fetch(path, { method: init.method ?? "GET", headers, ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) });
}

type Sent = "idle" | "busy" | "sent" | "duplicate" | "limit" | "failed";

export async function sendReport(body: { target: "username" | "result" | "appeal"; username?: string; resultId?: string }): Promise<Sent> {
  try {
    const response = await authedFetch("/api/reports", { method: "POST", body });
    if (!response) return "failed";
    if (response.ok) return "sent";
    if (response.status === 409) return "duplicate";
    if (response.status === 429) return "limit";
    return "failed";
  } catch {
    return "failed";
  }
}

/** One click, signed in only. Nothing acts on a report by itself, so there is no confirmation step to make it heavier. */
export function ReportLink({
  lang,
  username,
  resultId,
  label,
  className = "bd-report",
}: {
  lang: Lang;
  username?: string;
  resultId?: string;
  label?: string;
  className?: string;
}) {
  const signedIn = useSignedIn();
  const [state, setState] = useState<Sent>("idle");
  if (!signedIn) return null;
  const t = boardStrings(lang).report;
  if (state !== "idle" && state !== "busy") {
    const said = state === "sent" ? t.sent : state === "duplicate" ? t.duplicate : state === "limit" ? t.limit : t.failed;
    return (
      <span className={className} role="status">
        {said}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`${className} hit`}
      disabled={state === "busy"}
      onClick={() => {
        setState("busy");
        void sendReport(resultId ? { target: "result", resultId } : { target: "username", username: username ?? "" }).then(setState);
      }}
    >
      {label ?? t.row}
    </button>
  );
}

/** The last line of a profile or a result: absent for guests, so it leaves no empty gap above the footer. */
export function ReportLine(props: { lang: Lang; username?: string; resultId?: string; label: string }) {
  const signedIn = useSignedIn();
  if (!signedIn) return null;
  return (
    <p className="bd-last">
      <ReportLink {...props} className="bd-text-action" />
    </p>
  );
}
