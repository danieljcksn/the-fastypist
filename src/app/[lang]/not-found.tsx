import type { Metadata } from "next";
import Link from "next/link";
import { lang as rootLang } from "next/root-params";
import { NotFoundSync } from "@/components/site/not-found-sync";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { href, isLang, type Lang } from "@/i18n";
import { SITE_NAME } from "@/i18n/seo";
import { notFoundStrings } from "@/i18n/pages/not-found";

async function currentLang(): Promise<Lang> {
  const value = await rootLang();
  return isLang(value) ? value : "en";
}

export async function generateMetadata(): Promise<Metadata> {
  return { title: notFoundStrings(await currentLang()).title };
}

export default async function NotFound() {
  const lang = await currentLang();
  const t = notFoundStrings(lang);
  return (
    <>
      <NotFoundSync title={`${t.title} · ${SITE_NAME}`} />
      <SiteHeader lang={lang} />
      <main className="column" style={{ paddingTop: "3.5rem" }}>
        <h1 style={{ fontSize: "var(--t-xl)", lineHeight: "2.75rem", fontWeight: 400, letterSpacing: "-0.01em" }}>{t.statement}</h1>
        <p style={{ marginBlock: "1rem 2rem", color: "var(--secondary)" }}>{t.body}</p>
        <Link href={href(lang, "/")} style={{ textDecoration: "underline", textDecorationThickness: "0.0625em", textUnderlineOffset: "0.2em" }}>
          {t.home}
        </Link>
      </main>
      <SiteFooter lang={lang} />
    </>
  );
}
