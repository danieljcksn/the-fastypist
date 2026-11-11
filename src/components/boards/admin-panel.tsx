"use client";

import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/components/account/use-api";
import type { Lang } from "@/i18n";
import { boardStrings } from "@/i18n/boards";
import { accuracyText, wpmText } from "./model";
import "./boards.css";

interface Report {
  id: number;
  target: "username" | "result" | "appeal";
  subject_id: number;
  username: string | null;
  result_id: string | null;
  note: string | null;
  created_at: string;
}

interface Held {
  id: string;
  profile_id: number;
  username: string | null;
  wpm_cx: number;
  accuracy_bp: number;
  kind: string;
  reasons: string[];
  finished_at: string;
  retyped: boolean;
}

type Action = { action: "dismiss"; reportId: number } | { action: "release" | "void"; resultId: string } | { action: "ban" | "rename"; profileId: number };

function Titles({ lang }: { lang: Lang }) {
  const t = boardStrings(lang).admin;
  return <h1 className="bd-statement">{t.title}</h1>;
}

/** The same two headings the queues will have, so the page doesn't shift when they arrive. */
export function AdminSkeleton({ lang }: { lang: Lang }) {
  const t = boardStrings(lang).admin;
  return (
    <div className="bd">
      <Titles lang={lang} />
      <section className="bd-section bd-last">
        <h2 className="bd-title">{t.reports}</h2>
      </section>
      <section className="bd-section">
        <h2 className="bd-title">{t.held}</h2>
      </section>
    </div>
  );
}

const day = (iso: string) => iso.slice(0, 10);

export function AdminPanel({ lang }: { lang: Lang }) {
  const t = boardStrings(lang).admin;
  const api = useApi();
  const [data, setData] = useState<{ reports: Report[]; held: Held[] } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await api("/api/admin");
    if (!response.ok) {
      setNote(t.failed);
      return;
    }
    setData((await response.json()) as { reports: Report[]; held: Held[] });
  }, [api, t.failed]);

  useEffect(() => {
    void load().catch(() => setNote(t.failed));
  }, [load, t.failed]);

  async function act(body: Action) {
    setBusy(true);
    try {
      const response = await api("/api/admin", { method: "POST", body });
      setNote(response.ok ? t.done : t.failed);
      if (response.ok) await load();
    } catch {
      setNote(t.failed);
    } finally {
      setBusy(false);
    }
  }

  const button = (label: string, body: Action) => (
    <button type="button" className="bd-text-action hit" disabled={busy} onClick={() => void act(body)}>
      {label}
    </button>
  );

  return (
    <div className="bd">
      <Titles lang={lang} />
      <p className="bd-note" role="status" style={{ minHeight: "1.5rem", marginTop: "1rem" }}>
        {note}
      </p>
      <section className="bd-section bd-last" aria-labelledby="admin-reports">
        <div className="bd-head">
          <h2 className="bd-title" id="admin-reports">
            {t.reports}
          </h2>
          {data && data.reports.length === 0 ? <p className="bd-finding">{t.noReports}</p> : null}
        </div>
        {data && data.reports.length > 0 ? (
          <table className="bd-table">
            <tbody>
              {data.reports.map((r) => (
                <tr key={r.id}>
                  <td className="bd-acc">{t.target[r.target]}</td>
                  <td className="bd-name" style={{ maxWidth: "none", whiteSpace: "normal" }}>
                    {r.username ?? r.subject_id}
                    {r.note ? <span className="bd-you-tag">{r.note}</span> : null}
                  </td>
                  <td className="bd-acc">{day(r.created_at)}</td>
                  <td className="bd-n" style={{ display: "flex", gap: "1rem", justifyContent: "end", alignItems: "center", height: "2.75rem" }}>
                    {button(t.rename, { action: "rename", profileId: r.subject_id })}
                    {r.result_id ? button(t.void, { action: "void", resultId: r.result_id }) : null}
                    {button(t.ban, { action: "ban", profileId: r.subject_id })}
                    {button(t.dismiss, { action: "dismiss", reportId: r.id })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
      <section className="bd-section" aria-labelledby="admin-held">
        <div className="bd-head">
          <h2 className="bd-title" id="admin-held">
            {t.held}
          </h2>
          {data && data.held.length === 0 ? <p className="bd-finding">{t.noHeld}</p> : null}
        </div>
        {data && data.held.length > 0 ? (
          <table className="bd-table">
            <tbody>
              {data.held.map((h) => (
                <tr key={h.id}>
                  <td className="bd-name" style={{ maxWidth: "none", whiteSpace: "normal" }}>
                    {h.username ?? h.profile_id}
                    <span className="bd-you-tag">
                      {t.reasons} {h.reasons.join(", ")}
                    </span>
                  </td>
                  <td className="bd-wpm bd-n">{wpmText(h.wpm_cx)}</td>
                  <td className="bd-acc bd-n">{accuracyText(h.accuracy_bp)}</td>
                  <td className="bd-acc">{day(h.finished_at)}</td>
                  <td className="bd-n" style={{ display: "flex", gap: "1rem", justifyContent: "end", alignItems: "center", height: "2.75rem" }}>
                    {button(t.release, { action: "release", resultId: h.id })}
                    {button(t.void, { action: "void", resultId: h.id })}
                    {button(t.ban, { action: "ban", profileId: h.profile_id })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
    </div>
  );
}
