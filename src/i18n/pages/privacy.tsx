import Link from "next/link";
import { type InfoContent, Section, TextLink } from "@/components/site/info-page";
import { href, type Lang } from "../index";
import { CONTACT_URL } from "../seo";

const VERCEL = "https://vercel.com/legal/privacy-policy";
const CLERK = "https://clerk.com/legal/privacy";
const NEON = "https://neon.com/privacy-policy";
const ANPD = "https://www.gov.br/anpd/pt-br";
const EU_AUTHORITIES = "https://edpb.europa.eu/about-edpb/about-edpb/members_en";

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

export const privacy: Readonly<Record<Lang, InfoContent>> = {
  en: {
    title: "Privacy",
    description: "What this typing test stores, where it stays, how long it is kept, and how to export or delete it.",
    statement: "Without an account, everything stays on your device.",
    side: (
      <>
        <p>Daniel Jackson is the controller of your personal data and answers for how it is used.</p>
        <p>Last updated 6 November 2026. When this page changes, this date changes with it.</p>
        {sideLinks("en", "terms", "contact")}
      </>
    ),
    body: (
      <>
        <Section title="Without an account">
          <p>
            You can use the test with no account. Your settings, your results, any text you paste in and the keystrokes of up to 50 recent and best runs stay in this browser, in its local storage and IndexedDB. None of it is sent to us, and we set
            no cookies. Clearing this site&rsquo;s data erases it for good, because there is no other copy.
          </p>
        </Section>
        <Section title="Analytics">
          <p>
            We count page views and measure how quickly pages load, to see what gets used and what is slow. Vercel Web Analytics and Vercel Speed Insights do this, with no cookies and nothing about what you type. They start after the page has
            loaded, and never during a test.
          </p>
          <p>
            Their records hold the page address, the page you came from, your country, region and city, your browser, operating system and device type, your network speed, and how long the page took. Page views also carry a hash made from the
            request, which tells visitors apart for 24 hours and is then discarded.
          </p>
          <p>As with any website, our host receives your IP address when it serves you a page.</p>
        </Section>
        <Section title="With an account">
          <p>
            An account is optional. Clerk runs sign-in. It holds your email address, your password in hashed form or your link to the service you sign in with, such as Google, the name and picture that service shares, and your open sessions with
            their device and IP address. Its cookies, set when you open a sign-in page, keep you signed in, and they are the only cookies on this site.
          </p>
          <p>
            Our database, hosted by Neon, holds a reference to your Clerk account, when you joined, and your username if you pick one. When you sign up, the summaries of up to 500 runs in this browser move there as private history: the test, your
            speed, raw speed, accuracy, consistency, how long it took and when. They never count for ranking, and their keystrokes stay on your device. Until you turn ranking on, new runs stay on your device too.
          </p>
        </Section>
        <Section title="Ranking">
          <p>Ranking is a separate choice with its own unticked box, and an account works fine without it. This is what you agree to:</p>
          <blockquote>
            To check a ranked run was typed by a person, your browser sends us the keys you pressed and the time between them. We check the run and discard this, unless the run reaches a public top 10 or is flagged. Then we keep it for 30 days. We
            never use it to recognise you or to build a typing profile, and we never store how long a key was held.
          </blockquote>
          <p>For the same check your browser also sends how long each key was held. That is read once and never written anywhere. Turning ranking off on your account page stops all of this and erases any stored timings, while your own results stay.</p>
          <p>
            With ranking on, a run that goes through the check is saved with which test you took, the seed of its text, a hash of what was submitted, your speed, raw speed, accuracy and consistency, your speed second by second, when it finished, your
            local date, and whether you used a keyboard or a touch screen. We also keep daily totals, personal bests and, by week, how often each letter was hit or missed.
          </p>
          <p>
            Being listed is one more choice, also off by default. Once you are listed, anyone can see your username, when you joined, your Pace and percentile, your ranked personal bests and run count, your last 5 days on Today, and the pages of your
            ranked runs. Your email address, your time zone and the time of day you type are never public.
          </p>
        </Section>
        <Section title="How long it is kept">
          <table className="in-table">
            <thead>
              <tr>
                <th scope="col">Data</th>
                <th scope="col">Kept</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Results, daily totals, personal bests</td>
                <td>Until you delete your account</td>
              </tr>
              <tr>
                <td>Letter counts by week</td>
                <td>26 weeks</td>
              </tr>
              <tr>
                <td>Key timings of a flagged or top 10 run</td>
                <td>30 days, or until you turn ranking off</td>
              </tr>
              <tr>
                <td>Reports</td>
                <td>12 months after they are resolved</td>
              </tr>
              <tr>
                <td>Moderation decisions about you</td>
                <td>Until you delete your account</td>
              </tr>
              <tr>
                <td>A username you renamed away from</td>
                <td>Reserved for 30 days</td>
              </tr>
              <tr>
                <td>Rate limit counters</td>
                <td>2 days</td>
              </tr>
              <tr>
                <td>Visitor hash in analytics</td>
                <td>24 hours</td>
              </tr>
            </tbody>
          </table>
        </Section>
        <Section title="Export and delete">
          <p>Your account page has both. Export gives you everything we hold about your account as a JSON file. Delete removes your account and all its runs in one step, and everyone behind you on a board moves up.</p>
          <p>
            Two limits apply. The database&rsquo;s own history can hold deleted data for up to 6 hours, and we can&rsquo;t erase images that other platforms cached from a link you shared. Local history in this browser stays until you clear the
            site&rsquo;s data.
          </p>
        </Section>
        <Section title="Who handles your data">
          <table className="in-table">
            <thead>
              <tr>
                <th scope="col">Service</th>
                <th scope="col">Used for</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <TextLink href={VERCEL}>Vercel</TextLink>
                </td>
                <td>Hosting, analytics and load times</td>
              </tr>
              <tr>
                <td>
                  <TextLink href={CLERK}>Clerk</TextLink>
                </td>
                <td>Accounts and sign-in</td>
              </tr>
              <tr>
                <td>
                  <TextLink href={NEON}>Neon</TextLink>
                </td>
                <td>The database</td>
              </tr>
            </tbody>
          </table>
          <p>All 3 work from the United States, so your data leaves Brazil and the EU when you use an account or load a page. We sell nothing and share your data with no one else unless the law requires it.</p>
        </Section>
        <Section title="Legal bases">
          <table className="in-table">
            <thead>
              <tr>
                <th scope="col">Use</th>
                <th scope="col">Basis</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Your account, results and private stats</td>
                <td>Contract (GDPR Art. 6(1)(b), LGPD Art. 7 V)</td>
              </tr>
              <tr>
                <td>Public listing</td>
                <td>Your consent</td>
              </tr>
              <tr>
                <td>Key timing checks</td>
                <td>Legitimate interest under the GDPR (Art. 6(1)(f)), your consent under the LGPD</td>
              </tr>
              <tr>
                <td>Reports, moderation and analytics</td>
                <td>Legitimate interest (GDPR Art. 6(1)(f), LGPD Art. 7 IX)</td>
              </tr>
            </tbody>
          </table>
        </Section>
        <Section title="Your rights">
          <p>Your account page covers seeing, exporting and deleting your data, changing your username and turning off ranking or listing. Everything else below is a message away, wherever you live.</p>
          <p>
            In Brazil, the LGPD lets you confirm that we process your data, see it, correct it, have unnecessary or unlawful data anonymised, blocked or deleted, take it elsewhere, learn who it is shared with, and withdraw consent. You can ask for a
            person to review a decision made automatically, which is what retyping or requesting review of a held run does. Complaints go to the <TextLink href={ANPD}>ANPD</TextLink>.
          </p>
          <p>
            In the EU, the GDPR gives you access to your data and the rights to correct it, erase it, move it, restrict its use, and object to uses based on legitimate interest. Withdrawing consent never undoes what came before it. Complaints go to{" "}
            <TextLink href={EU_AUTHORITIES}>your national data protection authority</TextLink>.
          </p>
          <p>
            To ask us for any of this, use the <TextLink href={CONTACT_URL}>contact page</TextLink>. It may be public, so leave personal details out of your first message: say you have a privacy request and we will move to a private channel.
          </p>
        </Section>
        <Section title="Age">
          <p>
            The test has no minimum age, since it needs no account and your runs stay on your device. An account requires you to be at least 13. Where your country sets a higher age for agreeing to this on your own, a parent or guardian has to agree
            first.
          </p>
        </Section>
      </>
    ),
  },
  "pt-br": {
    title: "Privacidade",
    description: "O que este teste de digitação guarda, onde fica, por quanto tempo e como exportar ou excluir.",
    statement: "Sem conta, tudo fica no seu aparelho.",
    side: (
      <>
        <p>Daniel Jackson é o controlador dos seus dados pessoais e responde pelo uso deles.</p>
        <p>Atualizado em 6 de novembro de 2026. Quando esta página muda, esta data muda junto.</p>
        {sideLinks("pt-br", "termos", "contato")}
      </>
    ),
    body: (
      <>
        <Section title="Sem conta">
          <p>
            Você pode usar o teste sem conta. Suas configurações, seus resultados, qualquer texto que você colar e as teclas de até 50 testes recentes e melhores ficam neste navegador, no armazenamento local e no IndexedDB dele. Nada disso é enviado
            para nós, e não usamos cookies. Limpar os dados deste site apaga tudo de vez, porque não existe outra cópia.
          </p>
        </Section>
        <Section title="Estatísticas de uso">
          <p>
            Contamos as visitas às páginas e medimos a velocidade de carregamento, para ver o que é usado e o que está lento. Quem faz isso são o Vercel Web Analytics e o Vercel Speed Insights, sem cookies e sem nada do que você digita. Eles só começam
            depois que a página carrega, e nunca durante um teste.
          </p>
          <p>
            Esses registros guardam o endereço da página, a página de onde você veio, seu país, região e cidade, seu navegador, sistema operacional e tipo de aparelho, a velocidade da sua rede e quanto tempo a página levou. As visitas também levam um
            hash gerado a partir da requisição, que distingue visitantes por 24 horas e depois é descartado.
          </p>
          <p>Como em qualquer site, nossa hospedagem recebe seu endereço IP quando entrega uma página.</p>
        </Section>
        <Section title="Com conta">
          <p>
            A conta é opcional. O login fica a cargo da Clerk, que guarda seu e-mail, sua senha em forma de hash ou o vínculo com o serviço que você usa para entrar, como o Google, o nome e a foto que esse serviço compartilha, e suas sessões abertas,
            com aparelho e endereço IP. Os cookies dela, criados quando você abre uma página de login, mantêm você conectado, e são os únicos cookies deste site.
          </p>
          <p>
            Nosso banco de dados, hospedado na Neon, guarda uma referência à sua conta na Clerk, quando você entrou e seu nome de usuário, se escolher um. Quando você cria a conta, os resumos de até 500 testes deste navegador passam para lá como histórico
            privado: o teste, sua velocidade, velocidade bruta, precisão, consistência, quanto tempo levou e quando. Eles nunca contam para o ranking, e as teclas continuam no seu aparelho. Até você ligar o ranking, os testes novos também ficam no seu
            aparelho.
          </p>
        </Section>
        <Section title="Ranking">
          <p>O ranking é uma escolha à parte, com uma caixa própria e desmarcada, e a conta funciona normalmente sem ele. É com isto que você concorda:</p>
          <blockquote>
            Para confirmar que um teste do ranking foi digitado por uma pessoa, seu navegador nos envia as teclas pressionadas e o tempo entre elas. Verificamos o teste e descartamos esses dados, a menos que ele chegue ao top 10 público ou seja
            sinalizado. Nesse caso, guardamos por 30 dias. Nunca usamos isso para reconhecer você nem para montar um perfil de digitação, e nunca guardamos por quanto tempo uma tecla ficou pressionada.
          </blockquote>
          <p>Para a mesma verificação, seu navegador também envia por quanto tempo cada tecla ficou pressionada. Isso é lido uma vez e nunca gravado. Desligar o ranking na página da sua conta encerra tudo isso e apaga os tempos guardados, e seus resultados continuam seus.</p>
          <p>
            Com o ranking ligado, um teste que passa pela verificação é salvo com qual foi o teste, a semente do texto, um hash do que foi enviado, sua velocidade, velocidade bruta, precisão e consistência, sua velocidade segundo a segundo, quando
            terminou, sua data local e se você usou teclado ou tela de toque. Também guardamos totais por dia, recordes pessoais e, por semana, quantas vezes cada letra foi acertada ou errada.
          </p>
          <p>
            Aparecer na lista é mais uma escolha, também desligada de início. Na lista, qualquer pessoa pode ver seu nome de usuário, quando você entrou, seu Ritmo e percentil, seus recordes ranqueados e o número de testes, seus últimos 5 dias no
            Hoje e as páginas dos seus testes ranqueados. Seu e-mail, seu fuso horário e o horário em que você digita nunca ficam públicos.
          </p>
        </Section>
        <Section title="Por quanto tempo guardamos">
          <table className="in-table">
            <thead>
              <tr>
                <th scope="col">Dado</th>
                <th scope="col">Prazo</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Resultados, totais por dia, recordes pessoais</td>
                <td>Até você excluir a conta</td>
              </tr>
              <tr>
                <td>Contagem de letras por semana</td>
                <td>26 semanas</td>
              </tr>
              <tr>
                <td>Tempos de tecla de um teste sinalizado ou no top 10</td>
                <td>30 dias, ou até você desligar o ranking</td>
              </tr>
              <tr>
                <td>Denúncias</td>
                <td>12 meses depois de resolvidas</td>
              </tr>
              <tr>
                <td>Decisões de moderação sobre você</td>
                <td>Até você excluir a conta</td>
              </tr>
              <tr>
                <td>Nome de usuário que você trocou</td>
                <td>Reservado por 30 dias</td>
              </tr>
              <tr>
                <td>Contadores de limite de uso</td>
                <td>2 dias</td>
              </tr>
              <tr>
                <td>Hash de visitante nas estatísticas</td>
                <td>24 horas</td>
              </tr>
            </tbody>
          </table>
        </Section>
        <Section title="Exportar e excluir">
          <p>A página da sua conta tem as duas opções. Exportar entrega tudo o que guardamos sobre a sua conta em um arquivo JSON. Excluir remove a conta e todos os testes dela de uma vez, e quem estava atrás de você em um ranking sobe.</p>
          <p>Há 2 limites. O histórico do próprio banco de dados pode manter dados excluídos por até 6 horas, e não conseguimos apagar imagens que outras plataformas guardaram de um link que você compartilhou. O histórico local deste navegador fica até você limpar os dados do site.</p>
        </Section>
        <Section title="Quem trata seus dados">
          <table className="in-table">
            <thead>
              <tr>
                <th scope="col">Serviço</th>
                <th scope="col">Para quê</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <TextLink href={VERCEL}>Vercel</TextLink>
                </td>
                <td>Hospedagem, estatísticas de uso e tempos de carregamento</td>
              </tr>
              <tr>
                <td>
                  <TextLink href={CLERK}>Clerk</TextLink>
                </td>
                <td>Contas e login</td>
              </tr>
              <tr>
                <td>
                  <TextLink href={NEON}>Neon</TextLink>
                </td>
                <td>O banco de dados</td>
              </tr>
            </tbody>
          </table>
          <p>Os 3 operam a partir dos Estados Unidos, então seus dados saem do Brasil e da União Europeia quando você usa uma conta ou carrega uma página. Não vendemos nada e não compartilhamos seus dados com mais ninguém, salvo exigência legal.</p>
        </Section>
        <Section title="Bases legais">
          <table className="in-table">
            <thead>
              <tr>
                <th scope="col">Uso</th>
                <th scope="col">Base</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Sua conta, seus resultados e estatísticas privadas</td>
                <td>Execução de contrato (LGPD art. 7º, V; GDPR art. 6(1)(b))</td>
              </tr>
              <tr>
                <td>Aparecer na lista pública</td>
                <td>Seu consentimento</td>
              </tr>
              <tr>
                <td>Conferência do tempo entre teclas</td>
                <td>Seu consentimento na LGPD, legítimo interesse no GDPR (art. 6(1)(f))</td>
              </tr>
              <tr>
                <td>Denúncias, moderação e estatísticas de uso</td>
                <td>Legítimo interesse (LGPD art. 7º, IX; GDPR art. 6(1)(f))</td>
              </tr>
            </tbody>
          </table>
        </Section>
        <Section title="Seus direitos">
          <p>A página da sua conta cobre ver, exportar e excluir seus dados, trocar o nome de usuário e desligar o ranking ou a listagem. Todo o resto abaixo é só mandar uma mensagem, more onde morar.</p>
          <p>
            No Brasil, a LGPD permite confirmar que tratamos seus dados, ver esses dados, corrigir, pedir a anonimização, o bloqueio ou a eliminação do que for desnecessário ou ilegal, levar para outro serviço, saber com quem são compartilhados e
            retirar o consentimento. Você também pode pedir que uma pessoa revise uma decisão automatizada, e é isso que digitar de novo ou pedir revisão de um teste em verificação faz. Reclamações vão para a <TextLink href={ANPD}>ANPD</TextLink>.
          </p>
          <p>
            Na União Europeia, o GDPR dá acesso aos seus dados e o direito de corrigir, apagar, levar para outro serviço, restringir o uso e se opor a usos baseados em legítimo interesse. Retirar o consentimento não desfaz o que veio antes. Reclamações
            vão para a <TextLink href={EU_AUTHORITIES}>autoridade de proteção de dados do seu país</TextLink>.
          </p>
          <p>
            Para pedir qualquer uma dessas coisas, use a <TextLink href={CONTACT_URL}>página de contato</TextLink>. Ela pode ser pública, então deixe dados pessoais fora da primeira mensagem: diga que é um pedido de privacidade, e passamos para um canal
            privado.
          </p>
        </Section>
        <Section title="Idade">
          <p>O teste não tem idade mínima, já que dispensa conta e seus testes ficam no seu aparelho. Para ter uma conta, é preciso ter pelo menos 13 anos. Onde a lei do seu país exigir uma idade maior para aceitar isso sozinho, um responsável precisa concordar antes.</p>
        </Section>
      </>
    ),
  },
};
