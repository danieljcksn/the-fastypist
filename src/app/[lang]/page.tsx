import { notFound } from "next/navigation";
import { TypingHome } from "@/components/typing/typing-home";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import en1k from "@/engine/packs/en-1k@1.json";
import type { Pack } from "@/engine/packs";
import pt1k from "@/engine/packs/pt-1k@1.json";
import { dictionary, href, isLang } from "@/i18n";
import { PREPAINT_SCRIPT } from "@/typing/settings";

export const ensureStatic = "navigation";

export default async function Home({ params }: PageProps<"/[lang]">) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const { typing, footer } = dictionary(lang);
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: PREPAINT_SCRIPT }} />
      <SiteHeader lang={lang} />
      <main className="column">
        {/* Through the page's payload, not a client import: one client bundle serves both routes, so that would ship both lists. */}
        <TypingHome
          t={typing}
          pack={(lang === "en" ? en1k : pt1k) as Pack}
          otherLanguageHref={href(lang === "en" ? "pt-br" : "en", "/")}
          otherLanguageName={footer.otherLanguage}
        />
      </main>
      <SiteFooter lang={lang} />
    </>
  );
}
