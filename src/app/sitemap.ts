import type { MetadataRoute } from "next";
import { href, LANGS } from "@/i18n";
import { siteUrl } from "@/i18n/seo";
import { ACCOUNTS } from "@/lib/accounts-flag";

// Today only once anyone can rank: with accounts off it is a page that says so and nothing else.
const PAGES = ["/", ...(ACCOUNTS ? (["/today"] as const) : []), "/about", "/word-lists", "/privacy", "/terms"] as const;

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
