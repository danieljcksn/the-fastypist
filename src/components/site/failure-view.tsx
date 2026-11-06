"use client";

import { useState, type CSSProperties } from "react";
import { failureStrings } from "@/i18n/failure";

declare global {
  interface Window {
    __reloadForUpdate?: () => boolean;
  }
}

function isChunkFailure(error: unknown): boolean {
  return error instanceof Error && /chunk|dynamically imported module/i.test(`${error.name} ${error.message}`);
}

// Inline, because global-error replaces the document and takes the stylesheet with it. Only tokens, which it defines itself.
const ACTION: CSSProperties = {
  appearance: "none",
  background: "none",
  border: 0,
  padding: 0,
  font: "inherit",
  color: "var(--text)",
  cursor: "pointer",
  textDecoration: "underline",
  textDecorationThickness: "0.0625em",
  textUnderlineOffset: "0.2em",
};

export function FailureView({ error, lang, retry }: { error: unknown; lang: unknown; retry: () => void }) {
  const t = failureStrings(lang);
  const [updating] = useState(() => isChunkFailure(error) && typeof window !== "undefined" && window.__reloadForUpdate?.() === true);
  return (
    <main style={{ width: "min(72rem, 100% - 2.5rem)", marginInline: "auto", paddingBlock: "3.5rem" }}>
      {updating ? (
        <p role="status" style={{ color: "var(--muted)" }}>
          {t.updating}
        </p>
      ) : (
        <>
          <h1 style={{ fontSize: "var(--t-xl)", lineHeight: "2.75rem", fontWeight: 400, letterSpacing: "-0.01em", margin: 0 }}>{t.title}</h1>
          <p style={{ marginBlock: "1rem 2rem", color: "var(--secondary)" }}>{t.body}</p>
          <div style={{ display: "flex", gap: "1.5rem" }}>
            <button type="button" style={ACTION} onClick={retry}>
              {t.retry}
            </button>
            {/* A full load, since the router may be what failed. */}
            <a style={ACTION} href={lang === "pt-br" ? "/pt-br" : "/"}>
              {t.home}
            </a>
          </div>
        </>
      )}
    </main>
  );
}
