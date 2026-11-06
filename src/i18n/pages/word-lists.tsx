import { type InfoContent, Section, TextLink } from "@/components/site/info-page";
import enQuotes from "@/engine/quotes/en@1.json";
import provenance from "@/engine/quotes/provenance@1.json";
import ptQuotes from "@/engine/quotes/pt@1.json";
import type { Lang } from "../index";
import { REPO_URL } from "../seo";

const FREQUENCY_WORDS = "https://github.com/hermitdave/FrequencyWords";
const FREQUENCY_WORDS_COMMIT = "https://github.com/hermitdave/FrequencyWords/tree/525f9b560de45753a5ea01069454e72e9aa541c6";
const CC_BY_SA = "https://creativecommons.org/licenses/by-sa/4.0/";
const PACKS = `${REPO_URL}/tree/main/src/engine/packs`;
const OFL = "https://openfontlicense.org";
const RED_HAT = "https://github.com/RedHatOfficial/RedHatFont";
const POPPINS = "https://github.com/itfoundry/Poppins";
const STUDY = "https://doi.org/10.1145/3173574.3174220";
const STUDY_SITE = "https://userinterfaces.aalto.fi/136Mkeystrokes/";
const DICTIONARIES = "https://github.com/wooorm/dictionaries";
const CUSS = "https://github.com/words/cuss";
const LDNOOBW = "https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words";
const GUTENBERG = "https://www.gutenberg.org";
const WIKISOURCE = "https://pt.wikisource.org";

interface QuoteRow {
  author: string;
  work: string;
  year: number;
}

const COUNT = enQuotes.quotes.length;
const AUTHORS: Record<string, { died: number }> = provenance.authors;

/** Read from the pack itself, so this page can't name a work the test doesn't use, or miss one it does. */
function authorsOf(quotes: readonly QuoteRow[], locale: string) {
  const works = new Map<string, Map<string, number>>();
  for (const { author, work, year } of quotes) {
    const list = works.get(author) ?? new Map<string, number>();
    list.set(work, year);
    works.set(author, list);
  }
  return [...works.entries()]
    .map(([author, list]) => ({
      author,
      died: AUTHORS[author]?.died,
      works: [...list.entries()].sort((a, b) => a[1] - b[1]),
    }))
    .sort((a, b) => a.author.localeCompare(b.author, locale));
}

function QuoteSources({ quotes, locale, died }: { quotes: readonly QuoteRow[]; locale: string; died: (year: number) => string }) {
  return (
    <dl>
      {authorsOf(quotes, locale).map(({ author, died: year, works }) => (
        <div className="in-author" key={author}>
          <dt>
            {author}
            {year === undefined ? null : `, ${died(year)}`}
          </dt>
          <dd>{works.map(([work, published]) => `${work} (${published})`).join(", ")}</dd>
        </div>
      ))}
    </dl>
  );
}

function Attribution({ labels, corpus, citation }: { labels: readonly [string, string, string, string, string, string, string]; corpus: string; citation: string }) {
  return (
    <dl className="in-pairs">
      <dt>{labels[0]}</dt>
      <dd>
        FrequencyWords, <code>content/2018</code>, <code>en_50k</code>, <code>pt_br_50k</code>
      </dd>
      <dt>{labels[1]}</dt>
      <dd>Hermit Dave</dd>
      <dt>{labels[2]}</dt>
      <dd>Copyright (c) 2016 Hermit Dave</dd>
      <dt>{labels[3]}</dt>
      <dd>
        <TextLink href={FREQUENCY_WORDS}>github.com/hermitdave/FrequencyWords</TextLink>, commit <TextLink href={FREQUENCY_WORDS_COMMIT}>525f9b5</TextLink>
      </dd>
      <dt>{labels[4]}</dt>
      <dd>
        <TextLink href={CC_BY_SA}>CC BY-SA 4.0</TextLink>
      </dd>
      <dt>{labels[5]}</dt>
      <dd>{corpus}</dd>
      <dt>{labels[6]}</dt>
      <dd>{citation}</dd>
    </dl>
  );
}

export const wordLists: Readonly<Record<Lang, InfoContent>> = {
  en: {
    title: "Word lists",
    description: "Attribution for the word lists, quotes and fonts, and the study behind the percentile.",
    statement: "Where the words come from, and what we owe for them.",
    side: (
      <>
        <p>The lists are free to reuse under the same licence.</p>
        <div className="in-side-links">
          <a className="hit in-link" href={PACKS}>
            download the lists
          </a>
        </div>
      </>
    ),
    body: (
      <>
        <Section title="Word lists">
          <p>Every list, in English and Brazilian Portuguese at 200, 1k and 5k, is adapted from FrequencyWords, which counts how often words appear in film and television subtitles.</p>
          <Attribution
            labels={["Title", "Author", "Copyright notice", "Source", "Licence", "Corpus", "Corpus citation"]}
            corpus="OpenSubtitles 2018, as named by the source, built from subtitles at opensubtitles.org"
            citation="P. Lison and J. Tiedemann, 2016, OpenSubtitles2016: Extracting Large Parallel Corpora from Movie and TV Subtitles. In Proceedings of the 10th International Conference on Language Resources and Evaluation (LREC 2016)"
          />
        </Section>
        <Section title="What we changed">
          <p>The lists are adapted: filtered and reviewed. We dropped the occurrence counts and removed:</p>
          <ul>
            <li>words that fail a spelling dictionary</li>
            <li>words longer than 14 letters</li>
            <li>words with characters other than letters</li>
            <li>words a person removed by hand: profanity, slurs, proper names, abbreviations, interjections, foreign words, misspellings, subtitle captions and credits, and words about death or violence</li>
          </ul>
          <p>What remained was cut to its 200, 1,000 and 5,000 most frequent words, in the source&rsquo;s frequency order.</p>
        </Section>
        <Section title="What the licence asks">
          <p>
            <TextLink href={CC_BY_SA}>CC BY-SA 4.0</TextLink> lets anyone share and adapt this material, commercially too, on two conditions: credit the source and say what changed, which this page does, and release any adaptation under the same licence.
          </p>
          <p>
            Our adapted lists are therefore also under CC BY-SA 4.0, and <TextLink href={PACKS}>you can download them</TextLink>. The source lists and ours come with no warranties: see Section 5 of the licence for the disclaimer and the limitation of
            liability. The licence covers the word lists and their review files, not the code of this site.
          </p>
        </Section>
        <Section title="Quotes">
          <p>
            All {COUNT} passages in each language are in the public domain and were written in that language, never translated. Every author died by 1955, past the 70 years of Brazil&rsquo;s Lei 9.610, art. 41, and every work was first published before
            1931, which clears the United States.
          </p>
          <p>
            The texts come from <TextLink href={GUTENBERG}>Project Gutenberg</TextLink> and <TextLink href={WIKISOURCE}>Wikisource</TextLink>. Spelling in older Portuguese editions is updated to today&rsquo;s standard, and the words are the author&rsquo;s.
          </p>
          <h3>In English</h3>
          <QuoteSources quotes={enQuotes.quotes} locale="en" died={(year) => `died ${year}`} />
          <h3>In Portuguese</h3>
          <QuoteSources quotes={ptQuotes.quotes} locale="pt-BR" died={(year) => `died ${year}`} />
        </Section>
        <Section title="Fonts">
          <p>
            <TextLink href={RED_HAT}>Red Hat Text and Red Hat Mono</TextLink>, Copyright 2021 The Red Hat Project Authors, set everything you read here. The wordmark is drawn from <TextLink href={POPPINS}>Poppins</TextLink> SemiBold Italic, Copyright
            2014-2019 Indian Type Foundry. Both are under the <TextLink href={OFL}>SIL Open Font License 1.1</TextLink>.
          </p>
        </Section>
        <Section title="The percentile">
          <p>
            &ldquo;Faster than about 82% of typists&rdquo; compares you with a curve fitted to the published summary of{" "}
            <TextLink href={STUDY}>Dhakal, Feit, Kristensson and Oulasvirta, Observations on Typing from 136 Million Keystrokes, CHI 2018</TextLink>: 168,000 volunteers, a mean of 51.56 wpm, a standard deviation of 20.2 and a skewness of 0.513. Only
            those figures are used, never <TextLink href={STUDY_SITE}>the dataset</TextLink>.
          </p>
          <p>Those volunteers copied sentences and you are typing common words, so the percentile is approximate and probably flatters you a little. It is measured against that one fixed group and never against other people on this site.</p>
        </Section>
        <Section title="Used to build, never shipped">
          <p>
            Two spelling dictionaries decided which words count as real, and no part of them is in the lists: <TextLink href={DICTIONARIES}>dictionary-en 4.0.0</TextLink>, derived from SCOWL under its own permissive licence, and{" "}
            <TextLink href={DICTIONARIES}>dictionary-pt 4.0.0</TextLink>, derived from VERO by Raimundo Moura under LGPL-3.0 or MPL-2.0. Hand review used <TextLink href={CUSS}>cuss</TextLink> (MIT) and <TextLink href={LDNOOBW}>LDNOOBW</TextLink> (CC BY
            4.0) as a queue of words to read.
          </p>
        </Section>
      </>
    ),
  },
  "pt-br": {
    title: "Listas de palavras",
    description: "Créditos das listas de palavras, citações e fontes, e o estudo por trás do percentil.",
    statement: "De onde vêm as palavras, e o crédito que devemos por elas.",
    side: (
      <>
        <p>As listas podem ser reutilizadas de graça, sob a mesma licença.</p>
        <div className="in-side-links">
          <a className="hit in-link" href={PACKS}>
            baixar as listas
          </a>
        </div>
      </>
    ),
    body: (
      <>
        <Section title="Listas de palavras">
          <p>Todas as listas, em inglês e em português do Brasil, com 200, 1 mil e 5 mil palavras, são adaptadas do FrequencyWords, que conta a frequência das palavras em legendas de filmes e séries.</p>
          <Attribution
            labels={["Título", "Autor", "Direitos autorais", "Fonte", "Licença", "Corpus", "Citação do corpus"]}
            corpus="OpenSubtitles 2018, como a fonte o chama, feito a partir de legendas de opensubtitles.org"
            citation="P. Lison e J. Tiedemann, 2016, OpenSubtitles2016: Extracting Large Parallel Corpora from Movie and TV Subtitles. In Proceedings of the 10th International Conference on Language Resources and Evaluation (LREC 2016)"
          />
        </Section>
        <Section title="O que mudamos">
          <p>As listas são adaptadas: filtradas e revisadas. Tiramos as contagens de ocorrência e removemos:</p>
          <ul>
            <li>palavras reprovadas por um dicionário ortográfico</li>
            <li>palavras com mais de 14 letras</li>
            <li>palavras com caracteres que não são letras</li>
            <li>palavras que uma pessoa removeu à mão: palavrões, ofensas, nomes próprios, abreviações, interjeições, palavras estrangeiras, erros de grafia, legendas de créditos e palavras sobre morte ou violência</li>
          </ul>
          <p>O que sobrou foi cortado nas 200, 1.000 e 5.000 palavras mais frequentes, na ordem de frequência da fonte.</p>
        </Section>
        <Section title="O que a licença pede">
          <p>
            A <TextLink href={CC_BY_SA}>CC BY-SA 4.0</TextLink> permite compartilhar e adaptar este material, inclusive para fins comerciais, com 2 condições: dar crédito à fonte e dizer o que mudou, como esta página faz, e publicar qualquer adaptação sob
            a mesma licença.
          </p>
          <p>
            Por isso nossas listas adaptadas também estão sob CC BY-SA 4.0, e <TextLink href={PACKS}>você pode baixá-las</TextLink>. As listas de origem e as nossas vêm sem garantias: veja a Seção 5 da licença sobre a isenção e a limitação de
            responsabilidade. A licença cobre as listas de palavras e os arquivos de revisão, não o código deste site.
          </p>
        </Section>
        <Section title="Citações">
          <p>
            Os {COUNT} trechos de cada idioma estão em domínio público e foram escritos nesse idioma, nunca traduzidos. Todos os autores morreram até 1955, além dos 70 anos da Lei 9.610, art. 41, e todas as obras saíram pela primeira vez antes de 1931, o
            que também as libera nos Estados Unidos.
          </p>
          <p>
            Os textos vêm do <TextLink href={GUTENBERG}>Project Gutenberg</TextLink> e do <TextLink href={WIKISOURCE}>Wikisource</TextLink>. A grafia de edições antigas em português foi atualizada para a norma de hoje, e as palavras são as do autor.
          </p>
          <h3>Em inglês</h3>
          <QuoteSources quotes={enQuotes.quotes} locale="en" died={(year) => `morreu em ${year}`} />
          <h3>Em português</h3>
          <QuoteSources quotes={ptQuotes.quotes} locale="pt-BR" died={(year) => `morreu em ${year}`} />
        </Section>
        <Section title="Fontes tipográficas">
          <p>
            <TextLink href={RED_HAT}>Red Hat Text e Red Hat Mono</TextLink>, Copyright 2021 The Red Hat Project Authors, compõem tudo o que você lê aqui. A marca é desenhada a partir da <TextLink href={POPPINS}>Poppins</TextLink> SemiBold Italic, Copyright
            2014-2019 Indian Type Foundry. As duas estão sob a <TextLink href={OFL}>SIL Open Font License 1.1</TextLink>.
          </p>
        </Section>
        <Section title="O percentil">
          <p>
            &ldquo;Mais rápido que cerca de 82% das pessoas&rdquo; compara você com uma curva ajustada ao resumo publicado de{" "}
            <TextLink href={STUDY}>Dhakal, Feit, Kristensson e Oulasvirta, Observations on Typing from 136 Million Keystrokes, CHI 2018</TextLink>: 168.000 voluntários, média de 51,56 wpm, desvio padrão de 20,2 e assimetria de 0,513. Só esses números são
            usados, nunca <TextLink href={STUDY_SITE}>os dados do estudo</TextLink>.
          </p>
          <p>Esses voluntários copiaram frases, e você digita palavras comuns, então o percentil é aproximado e provavelmente favorece você um pouco. A comparação é sempre com esse grupo fixo, nunca com outras pessoas deste site.</p>
        </Section>
        <Section title="Usado na construção, nunca distribuído">
          <p>
            Dois dicionários ortográficos decidiram quais palavras contam como reais, e nenhuma parte deles está nas listas: <TextLink href={DICTIONARIES}>dictionary-en 4.0.0</TextLink>, derivado do SCOWL sob licença permissiva própria, e{" "}
            <TextLink href={DICTIONARIES}>dictionary-pt 4.0.0</TextLink>, derivado do VERO de Raimundo Moura sob LGPL-3.0 ou MPL-2.0. A revisão manual usou <TextLink href={CUSS}>cuss</TextLink> (MIT) e <TextLink href={LDNOOBW}>LDNOOBW</TextLink> (CC BY 4.0)
            como fila de palavras para ler.
          </p>
        </Section>
      </>
    ),
  },
};
