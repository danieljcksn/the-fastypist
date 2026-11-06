"use client";

import { useEffect, useId, useState } from "react";
import type { AccountStrings } from "@/i18n/account";
import { useApi } from "./use-api";

const DEBOUNCE_MS = 300;

type Problem = keyof AccountStrings["welcome"]["problems"];
export type NameCheck = { state: "empty" } | { state: "checking" } | { state: "free" } | { state: "bad"; problem: Problem } | { state: "unknown" };

export function UsernameField({
  s,
  value,
  onChange,
  onCheck,
}: {
  s: AccountStrings["welcome"];
  value: string;
  onChange(next: string): void;
  onCheck(next: NameCheck): void;
}) {
  const api = useApi();
  const id = useId();
  const [check, setCheck] = useState<NameCheck>({ state: "empty" });

  useEffect(() => {
    const name = value.trim();
    const report = (next: NameCheck) => {
      setCheck(next);
      onCheck(next);
    };
    if (name === "") {
      report({ state: "empty" });
      return;
    }
    report({ state: "checking" });
    let stale = false;
    const timer = setTimeout(() => {
      api(`/api/username?name=${encodeURIComponent(name)}`)
        .then((response) => (response.ok ? (response.json() as Promise<{ available: boolean; problem?: Problem }>) : null))
        .then(
          (answer) => {
            if (stale) return;
            if (!answer) report({ state: "unknown" });
            else report(answer.available ? { state: "free" } : { state: "bad", problem: answer.problem ?? "format" });
          },
          () => {
            if (!stale) report({ state: "unknown" });
          },
        );
    }, DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [value, api, onCheck]);

  const text = check.state === "checking" ? s.checking : check.state === "free" ? s.available : check.state === "bad" ? s.problems[check.problem] : "";
  const tone = check.state === "bad" ? "bad" : check.state === "free" ? "good" : undefined;
  return (
    <div>
      <label htmlFor={id} className="sr-only">
        {s.usernameLabel}
      </label>
      <input
        id={id}
        className="ac-input"
        data-testid="username"
        value={value}
        placeholder={s.usernameLabel}
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        maxLength={20}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="ac-status" data-tone={tone} data-testid="username-status" aria-live="polite" style={{ marginTop: "0.5rem" }}>
        {text}
      </p>
    </div>
  );
}
