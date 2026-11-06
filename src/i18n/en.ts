export const en = {
  htmlLang: "en",
  site: {
    description: "A typing test that opens ready to type. No sign-up, no ads. See what to practise next, and rank honestly when you want to.",
  },
  nav: { today: "today", progress: "progress", signIn: "sign in", home: "thefastypist, home" },
  footer: { otherLanguage: "português", about: "about", privacy: "privacy", wordLists: "word lists" },
} as const;

type Widen<T> = { -readonly [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };
export type Dictionary = Widen<typeof en>;
