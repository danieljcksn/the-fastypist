import Link from "next/link";
import { type InfoContent, Section, TextLink } from "@/components/site/info-page";
import { href, type Lang } from "../index";
import { CONTACT_URL } from "../seo";

const sideLinks = (lang: Lang, privacy: string, contact: string) => (
  <div className="in-side-links">
    <Link className="hit in-link" href={href(lang, "/privacy")} prefetch={false}>
      {privacy}
    </Link>
    <a className="hit in-link" href={CONTACT_URL}>
      {contact}
    </a>
  </div>
);

export const terms: Readonly<Record<Lang, InfoContent>> = {
  en: {
    title: "Terms",
    description: "The rules for using thefastypist and its boards.",
    statement: "Free to use, with one firm rule: no cheating on the boards.",
    side: (
      <>
        <p>Last updated 6 November 2026.</p>
        {sideLinks("en", "privacy", "contact")}
      </>
    ),
    body: (
      <>
        <Section title="The service">
          <p>thefastypist is a free typing test run by Daniel Jackson. Using it means you accept these terms, so if you don&rsquo;t, stop here. The test needs no account. The boards do.</p>
        </Section>
        <Section title="Accounts">
          <p>
            You must be at least 13 to create an account, and older where your country requires it, as the <TextLink href={href("en", "/privacy")}>privacy page</TextLink> explains. What happens under your sign-in is your responsibility. You can delete
            your account from your account page at any time.
          </p>
        </Section>
        <Section title="Fair play">
          <p>A ranked run has to be typed by you, by hand, on a physical keyboard. You may not:</p>
          <ul>
            <li>use a script, macro, auto-typer or anything else that types for you or sends us a made-up run</li>
            <li>use a second account to see a day&rsquo;s text before your attempt</li>
            <li>tamper with what the site sends, or try to get around its limits</li>
          </ul>
          <p>Today gives you one attempt, spent when the text is revealed, even if you never finish it.</p>
        </Section>
        <Section title="Holds and decisions">
          <p>
            Automatic checks can hold a run that looks implausible. A held run leaves the public boards and shows to you as being checked. You can retype to confirm it, or request a review by a person, which we aim to answer within 7 days.
          </p>
          <p>A moderator can release or void a run, rename a username or ban an account. There are no shadow bans: if you are banned, you can see it, and export and delete keep working.</p>
        </Section>
        <Section title="Usernames and reports">
          <p>A username can&rsquo;t offend or pass you off as someone else, and we can change one that does. Anyone signed in can report a profile or a run. A report changes nothing by itself, because a person reads it first.</p>
        </Section>
        <Section title="Who owns what">
          <p>
            Your results are yours to export or delete. If you list yourself, you allow us to show your username and results publicly until you stop. The word lists are under CC BY-SA 4.0 and the quotes are in the public domain, as the{" "}
            <TextLink href={href("en", "/word-lists")}>word lists page</TextLink> sets out. The site&rsquo;s code, design and wordmark belong to Daniel Jackson.
          </p>
        </Section>
        <Section title="No guarantees">
          <p>
            The site comes as it is, free of charge. Boards can be down, runs can be voided, and your browser can clear the history it keeps. As far as the law allows, we are not liable for lost data or for damage from using the site. Nothing here takes
            away consumer rights that the law says can&rsquo;t be waived.
          </p>
        </Section>
        <Section title="Changes">
          <p>We can change the site or these terms, or stop running it. When the terms change, the date on this page changes, and they apply from then on.</p>
        </Section>
      </>
    ),
  },
  "pt-br": {
    title: "Termos",
    description: "As regras para usar o thefastypist e os rankings dele.",
    statement: "De graça para usar, com uma regra firme: nada de trapaça nos rankings.",
    side: (
      <>
        <p>Atualizado em 6 de novembro de 2026.</p>
        {sideLinks("pt-br", "privacidade", "contato")}
      </>
    ),
    body: (
      <>
        <Section title="O serviço">
          <p>O thefastypist é um teste de digitação gratuito mantido por Daniel Jackson. Usar o site significa aceitar estes termos; se você não aceita, pare por aqui. O teste não precisa de conta. Os rankings precisam.</p>
        </Section>
        <Section title="Contas">
          <p>
            Para criar uma conta é preciso ter pelo menos 13 anos, e mais onde a lei do seu país exigir, como explica a <TextLink href={href("pt-br", "/privacy")}>página de privacidade</TextLink>. O que acontece com o seu login é responsabilidade sua.
            Você pode excluir a conta na página dela quando quiser.
          </p>
        </Section>
        <Section title="Jogo limpo">
          <p>Um teste ranqueado precisa ser digitado por você, à mão, em um teclado físico. Não é permitido:</p>
          <ul>
            <li>usar script, macro, digitador automático ou qualquer coisa que digite por você ou nos envie um teste inventado</li>
            <li>usar uma segunda conta para ver o texto do dia antes da sua tentativa</li>
            <li>adulterar o que o site envia ou tentar contornar os limites dele</li>
          </ul>
          <p>O Hoje dá 1 tentativa, gasta quando o texto aparece, mesmo que você não termine.</p>
        </Section>
        <Section title="Verificações e decisões">
          <p>Verificações automáticas podem segurar um teste que pareça improvável. Um teste nessa situação sai dos rankings públicos e aparece para você como em verificação. Você pode digitar de novo para confirmar ou pedir a revisão de uma pessoa, que tentamos responder em até 7 dias.</p>
          <p>A moderação pode liberar ou anular um teste, trocar um nome de usuário ou banir uma conta. Não existe banimento oculto: se você for banido, verá isso, e exportar e excluir continuam funcionando.</p>
        </Section>
        <Section title="Nomes de usuário e denúncias">
          <p>Um nome de usuário não pode ofender nem fazer você se passar por outra pessoa, e podemos trocar o que fizer isso. Quem está conectado pode denunciar um perfil ou um teste. Uma denúncia não muda nada sozinha, porque uma pessoa lê antes.</p>
        </Section>
        <Section title="De quem é o quê">
          <p>
            Seus resultados são seus, para exportar ou excluir. Se você aparecer na lista, autoriza que seu nome de usuário e seus resultados fiquem públicos até você sair dela. As listas de palavras estão sob CC BY-SA 4.0 e as citações estão em domínio
            público, como detalha a <TextLink href={href("pt-br", "/word-lists")}>página de listas de palavras</TextLink>. O código, o design e a marca do site pertencem a Daniel Jackson.
          </p>
        </Section>
        <Section title="Sem garantias">
          <p>
            O site vem como está, de graça. Os rankings podem ficar fora do ar, testes podem ser anulados e seu navegador pode limpar o histórico que guarda. Até onde a lei permite, não respondemos por dados perdidos nem por danos causados pelo uso do
            site. Nada aqui retira direitos do consumidor que a lei considera irrenunciáveis.
          </p>
        </Section>
        <Section title="Mudanças">
          <p>Podemos mudar o site ou estes termos, ou deixar de manter o site. Quando os termos mudam, a data nesta página muda, e eles valem a partir daí.</p>
        </Section>
      </>
    ),
  },
};
