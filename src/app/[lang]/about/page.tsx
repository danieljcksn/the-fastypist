import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InfoPage } from "@/components/site/info-page";
import { isLang } from "@/i18n";
import { about } from "@/i18n/pages/about";
import { pageMeta } from "@/i18n/seo";

export const ensureStatic = "navigation";

export async function generateMetadata({ params }: PageProps<"/[lang]/about">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  const { title, description } = about[lang];
  return pageMeta(lang, "/about", { title, description });
}

export default async function AboutPage({ params }: PageProps<"/[lang]/about">) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const { statement, side, body } = about[lang];
  return (
    <InfoPage lang={lang} path="/about" statement={statement} side={side} sideLast>
      {body}
    </InfoPage>
  );
}
