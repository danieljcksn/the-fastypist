"use client";

import { useUser } from "@clerk/nextjs";
import { useCallback, useEffect, useState } from "react";
import { accountStrings } from "@/i18n/account";
import { href, type Lang } from "@/i18n";
import { writeAccount } from "@/typing/ranked/account";
import { localRows } from "@/typing/ranked/import";
import { useApi } from "./use-api";
import { type NameCheck, UsernameField } from "./username-field";

type Problem = keyof ReturnType<typeof accountStrings>["welcome"]["problems"];

export function WelcomeForm({ lang }: { lang: Lang }) {
  const s = accountStrings(lang).welcome;
  const { isLoaded, isSignedIn, user } = useUser();
  const api = useApi();
  const [imported, setImported] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [check, setCheck] = useState<NameCheck>({ state: "empty" });
  const [consent, setConsent] = useState(false);
  const [listed, setListed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const home = href(lang, "/");
  const onCheck = useCallback((next: NameCheck) => setCheck(next), []);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      window.location.assign(href(lang, "/sign-in"));
      return;
    }
    const rows = localRows();
    if (rows.length === 0) return;
    let stale = false;
    api("/api/me/import", { method: "POST", body: { rows } })
      .then((response) => (response.ok ? (response.json() as Promise<{ imported: number }>) : null))
      .then(
        (answer) => {
          if (!stale && answer && answer.imported > 0) setImported(answer.imported);
        },
        () => undefined,
      );
    return () => {
      stale = true;
    };
  }, [isLoaded, isSignedIn, api, lang]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const username = name.trim();
    if (consent && username === "") {
      setMessage(s.needName);
      return;
    }
    if (username === "") {
      window.location.assign(home);
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const response = consent
        ? await api("/api/me/consent", { method: "POST", body: { consent: true, username, listed } })
        : await api("/api/username", { method: "POST", body: { username } });
      if (!response.ok) {
        const answer = (await response.json().catch(() => null)) as { error?: Problem } | null;
        setMessage(answer?.error && answer.error in s.problems ? s.problems[answer.error] : s.failed);
        return;
      }
      if (user) writeAccount({ uid: user.id, username: username.toLowerCase(), consent, listed: consent && listed, at: Date.now() });
      window.location.assign(home);
    } catch {
      setMessage(s.failed);
    } finally {
      setSaving(false);
    }
  };

  const blocked = saving || check.state === "bad" || check.state === "checking" || (consent && name.trim() === "");
  return (
    <form onSubmit={(e) => void save(e)} data-testid="welcome-form">
      <h1 className="ac-statement">{s.title}</h1>
      <p className="ac-lead">{s.lead}</p>
      <p className="ac-quiet" data-testid="imported" aria-live="polite">
        {imported === null ? null : `${s.imported(imported)} ${s.rankedFrom}`}
      </p>

      <section className="ac-section">
        <h2 className="ac-title">{s.usernameTitle}</h2>
        <p className="ac-text">{s.usernameHelp}</p>
        <UsernameField s={s} value={name} onChange={setName} onCheck={onCheck} />
      </section>

      <section className="ac-section">
        <h2 className="ac-title">{s.rankingTitle}</h2>
        <label className="ac-check">
          <input
            type="checkbox"
            data-testid="consent"
            checked={consent}
            onChange={(e) => {
              setConsent(e.target.checked);
              if (!e.target.checked) setListed(false);
            }}
          />
          <span>{s.rankingLabel}</span>
        </label>
        <p className="ac-text">{s.disclosure}</p>
        <label className="ac-check" data-off={consent ? undefined : ""}>
          <input type="checkbox" data-testid="listed" checked={listed} disabled={!consent} onChange={(e) => setListed(e.target.checked)} />
          <span>{s.listingLabel}</span>
        </label>
        <p className="ac-text">{s.listingHelp}</p>
      </section>

      <div className="ac-actions" style={{ marginTop: "6rem" }}>
        <button type="submit" className="ac-btn" data-primary="" data-testid="save" disabled={blocked}>
          {saving ? s.saving : s.save}
        </button>
        <a className="ac-link" href={home}>
          {s.skip}
        </a>
      </div>
      <p className="ac-status" data-tone="bad" role="alert" style={{ marginTop: "1rem" }}>
        {message}
      </p>
    </form>
  );
}
