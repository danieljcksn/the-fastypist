import type { MetadataRoute } from "next";
import { href, LANGS } from "@/i18n";
import { siteUrl } from "@/i18n/seo";
import { ACCOUNTS } from "@/lib/accounts-flag";

// Standings is a section of /today, not a page of its own. With accounts off /today only says it is closed.
const RANKING = ACCOUNTS ? (["/today"] as const) : [];
const PAGES = ["/", ...RANKING, "/about", "/word-lists", "/privacy", "/terms"] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const url = (path: string) => new URL(path, base).href;
  return PAGES.flatMap((page) =>
    LANGS.map((lang) => ({
      url: url(href(lang, page)),
      alternates: { languages: { en: url(href("en", page)), "pt-BR": url(href("pt-br", page)) } },
    })),
  );
}
