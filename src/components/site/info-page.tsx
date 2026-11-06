import type { ReactNode } from "react";
import type { Lang } from "@/i18n";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import "./info.css";

export interface InfoContent {
  title: string;
  description: string;
  statement: string;
  side: ReactNode;
  body: ReactNode;
}

export function InfoPage({
  lang,
  path,
  statement,
  side,
  sideLast,
  children,
}: {
  lang: Lang;
  path: `/${string}`;
  statement: ReactNode;
  side: ReactNode;
  sideLast?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <SiteHeader lang={lang} />
      <main className="column in" data-side={sideLast ? "last" : undefined}>
        <h1 className="in-statement">{statement}</h1>
        <div className="in-body">{children}</div>
        <aside className="in-side">{side}</aside>
      </main>
      <SiteFooter lang={lang} otherPath={path} />
    </>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="in-link" href={href}>
      {children}
    </a>
  );
}
