/** Loaded on every page with the error boundaries, so this file holds nothing else and no dictionary comes with it. */
const en = {
  title: "This page failed to load.",
  body: "Your results are safe on this device. Try again, or go back to the test.",
  retry: "try again",
  home: "start typing",
  updating: "Loading the latest version…",
};

const ptBr: typeof en = {
  title: "Esta página não carregou.",
  body: "Seus resultados estão guardados neste aparelho. Tente de novo ou volte para o teste.",
  retry: "tentar de novo",
  home: "começar a digitar",
  updating: "Carregando a versão mais recente…",
};

export const failureStrings = (lang: unknown) => (lang === "pt-br" ? ptBr : en);
