import Link from "next/link";
import { dictionary, href, type Lang } from "@/i18n";

export function SiteFooter({ lang, otherPath = "/" }: { lang: Lang; otherPath?: `/${string}` }) {
  const t = dictionary(lang).footer;
  const other: Lang = lang === "en" ? "pt-br" : "en";
  return (
    <footer data-chrome className="column mt-auto flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-10 text-s">
      <Link className="hit link-quiet" href={href(other, otherPath)} hrefLang={other === "pt-br" ? "pt-BR" : "en"}>
        {t.otherLanguage}
      </Link>
      <nav className="flex gap-6">
        <Link className="hit link-quiet" href={href(lang, "/about")}>{t.about}</Link>
        <Link className="hit link-quiet" href={href(lang, "/privacy")}>{t.privacy}</Link>
        <Link className="hit link-quiet" href={href(lang, "/word-lists")}>{t.wordLists}</Link>
      </nav>
    </footer>
  );
}
