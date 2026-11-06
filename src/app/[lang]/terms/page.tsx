import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InfoPage } from "@/components/site/info-page";
import { isLang } from "@/i18n";
import { terms } from "@/i18n/pages/terms";
import { pageMeta } from "@/i18n/seo";

export const ensureStatic = "navigation";

export async function generateMetadata({ params }: PageProps<"/[lang]/terms">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  const { title, description } = terms[lang];
  return pageMeta(lang, "/terms", { title, description });
}

export default async function TermsPage({ params }: PageProps<"/[lang]/terms">) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const { statement, side, body } = terms[lang];
  return (
    <InfoPage lang={lang} path="/terms" statement={statement} side={side}>
      {body}
    </InfoPage>
  );
}
