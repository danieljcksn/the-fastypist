import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InfoPage } from "@/components/site/info-page";
import { isLang } from "@/i18n";
import { privacy } from "@/i18n/pages/privacy";
import { pageMeta } from "@/i18n/seo";

export const ensureStatic = "navigation";

export async function generateMetadata({ params }: PageProps<"/[lang]/privacy">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  const { title, description } = privacy[lang];
  return pageMeta(lang, "/privacy", { title, description });
}

export default async function PrivacyPage({ params }: PageProps<"/[lang]/privacy">) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const { statement, side, body } = privacy[lang];
  return (
    <InfoPage lang={lang} path="/privacy" statement={statement} side={side}>
      {body}
    </InfoPage>
  );
}
