import type { Lang } from "../index";

const STRINGS = {
  en: {
    title: "Page not found",
    statement: "There is nothing at this address.",
    body: "It may be mistyped, or the page may have moved.",
    home: "start typing",
  },
  "pt-br": {
    title: "Página não encontrada",
    statement: "Não há nada neste endereço.",
    body: "O endereço pode ter um erro, ou a página mudou de lugar.",
    home: "começar a digitar",
  },
} as const;

export const notFoundStrings = (lang: Lang) => STRINGS[lang];
