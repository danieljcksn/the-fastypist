import type { Metadata } from "next";
import { href, type Lang } from "./index";

export const SITE_NAME = "thefastypist";
export const REPO_URL = "https://github.com/danieljcksn/the-fastypist";
export const CONTACT_URL = process.env.NEXT_PUBLIC_CONTACT_URL || `${REPO_URL}/issues`;

/** The production address on every build, so a preview deployment never claims to be canonical. */
export function siteUrl(): URL {
  if (process.env.NEXT_PUBLIC_SITE_URL) return new URL(process.env.NEXT_PUBLIC_SITE_URL);
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return new URL(vercel ? `https://${vercel}` : "http://localhost:3390");
}

const LOCALES: Readonly<Record<Lang, string>> = { en: "en_US", "pt-br": "pt_BR" };

/** Canonical and hreflang are per page: set on a layout, every child without its own would claim to be the parent. */
export function pageMeta(lang: Lang, path: `/${string}`, fields: { title?: string; description?: string }): Metadata {
  const canonical = href(lang, path);
  return {
    ...fields,
    alternates: {
      canonical,
      languages: { en: href("en", path), "pt-BR": href("pt-br", path), "x-default": href("en", path) },
    },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: LOCALES[lang],
      alternateLocale: LOCALES[lang === "en" ? "pt-br" : "en"],
      url: canonical,
      title: fields.title ?? SITE_NAME,
      description: fields.description,
    },
    twitter: { card: "summary_large_image" },
  };
}
