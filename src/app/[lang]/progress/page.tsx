import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProgressBody } from "@/components/progress/progress-body";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { isLang } from "@/i18n";
import { reportStrings } from "@/i18n/report";
import { HISTORY_KEY } from "@/typing/history/rows";
import { PREPAINT_SCRIPT } from "@/typing/settings";

export const ensureStatic = "navigation";

// The static HTML is the zero state. Someone with history must never see it flash, and the page must not grow into the footer.
const HISTORY_SCRIPT = `try{if(localStorage.getItem("${HISTORY_KEY}"))document.documentElement.dataset.history=""}catch(e){}`;

export async function generateMetadata({ params }: PageProps<"/[lang]/progress">): Promise<Metadata> {
  const { lang } = await params;
  return { title: isLang(lang) ? reportStrings(lang).progress.title : undefined };
}

export default async function ProgressPage({ params }: PageProps<"/[lang]/progress">) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: `${HISTORY_SCRIPT}${PREPAINT_SCRIPT}` }} />
      <SiteHeader lang={lang} current="progress" />
      <main className="column pg-main">
        <ProgressBody lang={lang} />
      </main>
      <SiteFooter lang={lang} otherPath="/progress" />
    </>
  );
}
