import Link from "next/link";
import { type InfoContent, Section } from "@/components/site/info-page";
import { href, type Lang } from "../index";
import { CONTACT_URL } from "../seo";

const sideLinks = (lang: Lang, terms: string, contact: string) => (
  <div className="in-side-links">
    <Link className="hit in-link" href={href(lang, "/terms")} prefetch={false}>
      {terms}
    </Link>
    <a className="hit in-link" href={CONTACT_URL}>
      {contact}
    </a>
  </div>
);

export const about: Readonly<Record<Lang, InfoContent>> = {
  en: {
    title: "About",
    description: "What thefastypist is, how it counts your speed, and who makes it.",
    statement: "A typing test that opens ready to type.",
    side: (
      <>
        <p>Made by Daniel Jackson.</p>
        {sideLinks("en", "terms", "contact")}
      </>
    ),
    body: (
      <>
        <Section title="Open the page and start">
          <p>There is no sign-up, no start button and no ads. The clock starts on your first letter, and one large number tells you how it went.</p>
          <p>Then you get something to do about it. Your results name the letter pairs that cost you the most speed, and one key starts a drill of real words built around them.</p>
        </Section>
        <Section title="Ranking, if you want it">
          <p>
            Everyone who opts in types the same 60 seconds of text each day, with one attempt, and a run counts once it has been checked. Your history stays in this browser until you make an account, and nothing is public unless you
            choose to list yourself.
          </p>
        </Section>
        <Section title="How speed is counted">
          <p>Only the letters of words you got right count, plus their spaces, and 5 characters make 1 word. A word with a mistake left in it adds nothing. Accuracy is the share of keys you got right, so a mistake you fix still counts against it.</p>
        </Section>
        <Section title="Two languages">
          <p>The interface and the words are both available in English and Brazilian Portuguese, and you can mix them. Every list and quote is credited on the word lists page.</p>
        </Section>
      </>
    ),
  },
  "pt-br": {
    title: "Sobre",
    description: "O que é o thefastypist, como ele conta sua velocidade e quem faz.",
    statement: "Um teste de digitação que abre pronto para digitar.",
    side: (
      <>
        <p>Feito por Daniel Jackson.</p>
        {sideLinks("pt-br", "termos", "contato")}
      </>
    ),
    body: (
      <>
        <Section title="Abra a página e comece">
          <p>Sem cadastro, sem botão de início e sem anúncios. O tempo começa na sua primeira letra, e um único número grande mostra como foi.</p>
          <p>Depois vem o que fazer com isso. O resultado aponta os pares de letras que mais custam velocidade, e 1 tecla abre um treino com palavras reais montado em torno deles.</p>
        </Section>
        <Section title="Ranking, se você quiser">
          <p>
            Quem entra digita o mesmo texto de 60 segundos a cada dia, com 1 tentativa, e o teste só vale depois de conferido. Seu histórico fica neste navegador até você criar uma conta, e nada fica público sem que você escolha aparecer na lista.
          </p>
        </Section>
        <Section title="Como a velocidade é contada">
          <p>Contam só as letras das palavras certas, mais os espaços, e 5 caracteres valem 1 palavra. Uma palavra que ficou com erro não soma nada. A precisão é a parte das teclas que você acertou, então um erro corrigido continua contando contra.</p>
        </Section>
        <Section title="Dois idiomas">
          <p>A interface e as palavras existem em inglês e em português do Brasil, e você pode misturar os dois. Cada lista e cada citação têm o crédito na página de listas de palavras.</p>
        </Section>
      </>
    ),
  },
};
