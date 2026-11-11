import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { href, type Lang } from "@/i18n";
import { boardStrings } from "@/i18n/boards";
import "./boards.css";

export function BoardFrame({
  lang,
  path,
  current,
  children,
}: {
  lang: Lang;
  path: `/${string}`;
  current?: "today";
  children: ReactNode;
}) {
  return (
    <>
      <SiteHeader lang={lang} current={current} />
      <main className="column bd">{children}</main>
      <SiteFooter lang={lang} otherPath={path} />
    </>
  );
}

/** A closed page is the same line at every address, so none of them belongs in a search result. */
export function closedMeta(lang: Lang): Metadata {
  return { title: boardStrings(lang).closed.title, robots: { index: false } };
}

/** With accounts off a ranking page is reachable but has nothing to rank: one plain line, and the way back to the test. */
export function ClosedPage({ lang, path }: { lang: Lang; path: `/${string}` }) {
  const t = boardStrings(lang).closed;
  return (
    <BoardFrame lang={lang} path={path}>
      <h1 className="bd-line" data-testid="boards-closed">
        {t.line}
      </h1>
      <Link className="bd-action bd-text-action hit" href={href(lang, "/")}>
        {t.action}
      </Link>
    </BoardFrame>
  );
}

export function Unavailable({ lang }: { lang: Lang }) {
  return (
    <div data-testid="boards-unavailable">
      <p className="bd-note">{boardStrings(lang).unavailable}</p>
      <Link className="bd-action bd-text-action hit" href={href(lang, "/")}>
        {boardStrings(lang).closed.action}
      </Link>
    </div>
  );
}
