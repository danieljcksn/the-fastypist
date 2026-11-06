"use client";

import { FailureView } from "@/components/site/failure-view";

// The root layout is gone by now, and its stylesheet and theme script with it. These are the tokens from globals.css.
const TOKENS = `:root{color-scheme:dark;--ground:#0f0e0c;--text:#f6f5f2;--secondary:#c9c5be;--muted:#8f8a84;--t-xl:2.25rem}
:root[data-theme="light"]{color-scheme:light;--ground:#fff;--text:#0f0e0c;--secondary:#3a3733;--muted:#6b6763}
body{margin:0;background:var(--ground);color:var(--text);font:1rem/1.5 ui-sans-serif,system-ui,sans-serif}`;

function themeOf(): string | undefined {
  if (typeof document === "undefined") return undefined;
  try {
    const saved = localStorage.getItem("fastypist:theme");
    if (saved === "light" || (saved === "system" && matchMedia("(prefers-color-scheme: light)").matches)) return "light";
  } catch {}
  return undefined;
}

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const lang = typeof location !== "undefined" && location.pathname.startsWith("/pt-br") ? "pt-br" : "en";
  return (
    <html lang={lang === "pt-br" ? "pt-BR" : "en"} data-theme={themeOf()}>
      <head>
        <style>{TOKENS}</style>
      </head>
      <body>
        <FailureView error={error} lang={lang} retry={retry} />
      </body>
    </html>
  );
}
