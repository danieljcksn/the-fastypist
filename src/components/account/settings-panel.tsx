"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import { useCallback, useEffect, useState } from "react";
import { accountStrings } from "@/i18n/account";
import { href, type Lang } from "@/i18n";
import { writeAccount } from "@/typing/ranked/account";
import { localRows } from "@/typing/ranked/import";
import { clearTickets } from "@/typing/ranked/pool";
import { useApi } from "./use-api";
import { type NameCheck, UsernameField } from "./username-field";

interface Me {
  username: string | null;
  consent: boolean;
  listed: boolean;
}

type Problem = keyof ReturnType<typeof accountStrings>["welcome"]["problems"];

export function SettingsPanel({ lang }: { lang: Lang }) {
  const t = accountStrings(lang);
  const s = t.settings;
  const { isLoaded, isSignedIn, user } = useUser();
  const clerk = useClerk();
  const api = useApi();
  const [me, setMe] = useState<Me | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [name, setName] = useState("");
  const [nameCheck, setNameCheck] = useState<NameCheck>({ state: "empty" });
  const [editing, setEditing] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [listedChecked, setListedChecked] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const onCheck = useCallback((next: NameCheck) => setNameCheck(next), []);
  const home = href(lang, "/");
  const uid = user?.id;

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      window.location.assign(href(lang, "/sign-in"));
      return;
    }
    let stale = false;
    api("/api/me").then(
      async (response) => {
        if (stale) return;
        if (!response.ok) {
          setLoadFailed(true);
          return;
        }
        const answer = (await response.json()) as Me;
        if (stale) return;
        setMe(answer);
        if (uid) writeAccount({ uid, ...answer, at: Date.now() });
      },
      () => {
        if (!stale) setLoadFailed(true);
      },
    );
    return () => {
      stale = true;
    };
  }, [isLoaded, isSignedIn, api, uid, lang]);

  const apply = (next: Me) => {
    setMe(next);
    if (uid) writeAccount({ uid, ...next, at: Date.now() });
    if (!next.consent) clearTickets();
  };

  const act = async (key: string, run: () => Promise<void>) => {
    setBusy(key);
    setNote(null);
    try {
      await run();
    } catch {
      setNote(s.failed);
    } finally {
      setBusy(null);
    }
  };

  const failure = async (response: Response) => {
    const answer = (await response.json().catch(() => null)) as { error?: Problem } | null;
    setNote(answer?.error && answer.error in t.welcome.problems ? t.welcome.problems[answer.error] : s.failed);
  };

  if (loadFailed) return <p className="ac-lead">{s.unavailable}</p>;
  if (!me) {
    return (
      <>
        <h1 className="ac-statement">{s.title}</h1>
        <p className="ac-lead" aria-live="polite">
          {s.loading}
        </p>
      </>
    );
  }

  const saveName = () =>
    act("name", async () => {
      const username = name.trim();
      const response = await api("/api/username", { method: "POST", body: { username } });
      if (!response.ok) return failure(response);
      apply({ ...me, username: username.toLowerCase() });
      setEditing(false);
      setName("");
    });

  const turnOn = () =>
    act("consent", async () => {
      const username = me.username ?? name.trim();
      const response = await api("/api/me/consent", { method: "POST", body: { consent: true, username, listed: listedChecked } });
      if (!response.ok) return failure(response);
      apply({ username: username.toLowerCase(), consent: true, listed: listedChecked });
      setConsentChecked(false);
      setListedChecked(false);
      setName("");
    });

  const turnOff = () =>
    act("consent", async () => {
      const response = await api("/api/me/consent", { method: "DELETE" });
      if (!response.ok) return failure(response);
      apply({ ...me, consent: false, listed: false });
    });

  const setListing = (listed: boolean) =>
    act("listing", async () => {
      const response = await api("/api/me/listing", { method: "POST", body: { listed } });
      if (!response.ok) return failure(response);
      apply({ ...me, listed });
    });

  const bringOver = () =>
    act("import", async () => {
      const rows = localRows();
      if (rows.length === 0) {
        setImportNote(s.importNone);
        return;
      }
      const response = await api("/api/me/import", { method: "POST", body: { rows } });
      if (!response.ok) return failure(response);
      const { imported } = (await response.json()) as { imported: number };
      setImportNote(imported > 0 ? t.welcome.imported(imported) : s.importNone);
    });

  const download = () =>
    act("export", async () => {
      const response = await api("/api/me/export");
      if (!response.ok) {
        setNote(s.exportFailed);
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "thefastypist-export.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    });

  const signOut = async () => {
    writeAccount(null);
    clearTickets();
    await clerk.signOut({ redirectUrl: home });
  };

  const remove = () =>
    act("delete", async () => {
      const response = await api("/api/me", { method: "DELETE", body: { confirm: "delete" } });
      if (!response.ok) {
        setNote(s.deleteFailed);
        return;
      }
      writeAccount(null);
      clearTickets();
      await clerk.signOut({ redirectUrl: home });
    });

  const canConsent = consentChecked && (me.username !== null || nameCheck.state === "free");
  const renaming = editing && (nameCheck.state === "free" || nameCheck.state === "unknown");
  return (
    <div data-testid="settings">
      <h1 className="ac-statement">{s.title}</h1>
      <p className="ac-status" role="alert" data-tone="bad" style={{ marginTop: "1rem" }}>
        {note}
      </p>

      <section className="ac-section">
        <h2 className="ac-title">{s.usernameTitle}</h2>
        <p className="ac-text" data-testid="current-username">
          {me.username ?? s.noUsername}
        </p>
        {editing ? <UsernameField s={t.welcome} value={name} onChange={setName} onCheck={onCheck} /> : null}
        <div className="ac-side">
          {editing ? (
            <button type="button" className="ac-btn" disabled={!renaming || busy !== null} onClick={() => void saveName()}>
              {s.saveName}
            </button>
          ) : (
            <button type="button" className="ac-link" onClick={() => setEditing(true)}>
              {s.rename}
            </button>
          )}
        </div>
      </section>

      <section className="ac-section">
        <h2 className="ac-title">{s.rankingTitle}</h2>
        <p className="ac-text" data-testid="ranking-state">
          {me.consent ? s.rankingOn : s.rankingOff}
        </p>
        {me.consent ? (
          <>
            <p className="ac-text" data-testid="listing-state">
              {me.listed ? s.listedOn : s.listedOff}
            </p>
            <div className="ac-side">
              <button type="button" className="ac-btn" data-testid="toggle-listing" disabled={busy !== null} onClick={() => void setListing(!me.listed)}>
                {me.listed ? s.unlist : s.list}
              </button>
              <button type="button" className="ac-link" data-testid="turn-off" disabled={busy !== null} onClick={() => void turnOff()}>
                {s.turnOff}
              </button>
            </div>
            <p className="ac-text">{s.turnOffNote}</p>
          </>
        ) : (
          <>
            {me.username === null && !editing ? <UsernameField s={t.welcome} value={name} onChange={setName} onCheck={onCheck} /> : null}
            <label className="ac-check">
              <input type="checkbox" data-testid="consent" checked={consentChecked} onChange={(e) => setConsentChecked(e.target.checked)} />
              <span>{t.welcome.rankingLabel}</span>
            </label>
            <p className="ac-text">{t.welcome.disclosure}</p>
            <label className="ac-check" data-off={consentChecked ? undefined : ""}>
              <input type="checkbox" data-testid="listed" checked={listedChecked} disabled={!consentChecked} onChange={(e) => setListedChecked(e.target.checked)} />
              <span>{t.welcome.listingLabel}</span>
            </label>
            <div className="ac-side">
              <button type="button" className="ac-btn" data-testid="turn-on" disabled={!canConsent || busy !== null} onClick={() => void turnOn()}>
                {s.turnOn}
              </button>
            </div>
          </>
        )}
      </section>

      <section className="ac-section">
        <h2 className="ac-title">{s.importTitle}</h2>
        <p className="ac-text">{s.importHelp}</p>
        <p className="ac-status" aria-live="polite" data-testid="import-note">
          {importNote}
        </p>
        <div className="ac-side">
          <button type="button" className="ac-btn" data-testid="bring-over" disabled={busy !== null} onClick={() => void bringOver()}>
            {s.importAction}
          </button>
        </div>
      </section>

      <section className="ac-section">
        <h2 className="ac-title">{s.exportTitle}</h2>
        <p className="ac-text">{s.exportHelp}</p>
        <div className="ac-side">
          <button type="button" className="ac-btn" data-testid="export" disabled={busy !== null} onClick={() => void download()}>
            {s.exportAction}
          </button>
        </div>
      </section>

      <section className="ac-section">
        <h2 className="ac-title">{s.profileTitle}</h2>
        <div className="ac-side">
          <button type="button" className="ac-btn" onClick={() => clerk.openUserProfile()}>
            {s.profileAction}
          </button>
          <button type="button" className="ac-link" data-testid="sign-out" onClick={() => void signOut()}>
            {s.signOut}
          </button>
        </div>
      </section>

      <section className="ac-section">
        <h2 className="ac-title">{s.deleteTitle}</h2>
        <p className="ac-text">{s.deleteHelp}</p>
        <label className="ac-text" htmlFor="ac-delete" style={{ display: "block" }}>
          {s.deleteLabel}
        </label>
        <input id="ac-delete" className="ac-input" data-testid="delete-confirm" autoComplete="off" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <div className="ac-side">
          <button
            type="button"
            className="ac-btn"
            data-danger=""
            data-testid="delete"
            disabled={confirm.trim().toLowerCase() !== s.deleteWord || busy !== null}
            onClick={() => void remove()}
          >
            {busy === "delete" ? s.deleting : s.deleteAction}
          </button>
        </div>
      </section>
    </div>
  );
}
