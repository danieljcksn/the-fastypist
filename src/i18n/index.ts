import { en, type Dictionary } from "./en";
import { ptBr } from "./pt-br";

export type Lang = "en" | "pt-br";

export const LANGS: readonly Lang[] = ["en", "pt-br"];

export function isLang(value: string): value is Lang {
  return value === "en" || value === "pt-br";
}

export function dictionary(lang: Lang): Dictionary {
  return lang === "pt-br" ? ptBr : en;
}

/** Prefixes a path for a language. English lives at the root. */
export function href(lang: Lang, path: `/${string}`): string {
  if (lang === "en") return path;
  return path === "/" ? "/pt-br" : `/pt-br${path}`;
}

export type { Dictionary };
