import type { MetadataRoute } from "next";
import { href, LANGS } from "@/i18n";
import { siteUrl } from "@/i18n/seo";
import { ACCOUNTS } from "@/lib/accounts-flag";

const RANKING = ACCOUNTS ? (["/today", "/standings"] as const) : [];
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
