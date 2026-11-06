import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InfoPage } from "@/components/site/info-page";
import { isLang } from "@/i18n";
import { wordLists } from "@/i18n/pages/word-lists";
import { pageMeta } from "@/i18n/seo";

export const ensureStatic = "navigation";

export async function generateMetadata({ params }: PageProps<"/[lang]/word-lists">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  const { title, description } = wordLists[lang];
  return pageMeta(lang, "/word-lists", { title, description });
}

export default async function WordListsPage({ params }: PageProps<"/[lang]/word-lists">) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const { statement, side, body } = wordLists[lang];
  return (
    <InfoPage lang={lang} path="/word-lists" statement={statement} side={side}>
      {body}
    </InfoPage>
  );
}
