import type { Diagnosis, MonthInsight, PairChange, SpeedFinding } from "@/engine/analysis";
import type { Lang } from "./index";

/** Strings for results and progress. Loaded with those screens, so none of this reaches the first load of the test. */
export interface ReportStrings {
  locale: string;
  wpm: string;
  accuracy: string;
  raw: string;
  consistency: string;
  rollover: string;
  enterKey: string;
  tabKey: string;
  newWords: string;
  drill(pairs: readonly string[]): string;
  drillAgain: string;
  noDrillWords: string;
  copySummary: string;
  copied: string;
  copyFailed: string;
  bestChange(diff: string, sign: -1 | 0 | 1): string;
  allWrongLetters: string;
  allWrongWords: string;
  diagnosis(d: Diagnosis, seed: string): string | null;
  mapTitle: string;
  mapLabel(slowest: readonly string[]): string;
  under(n: number): string;
  speedTitle: string;
  speedFinding(f: SpeedFinding): string;
  speedLabel(seconds: number): string;
  seconds(n: number): string;
  speedRead(wpm: number): string;
  speedReadSecond(second: number, mistakes: number): string;
  legendSpeed: string;
  legendEachSecond: string;
  legendMistake: string;
  speedShortNote: string;
  secondHead: string;
  speedAverageHead: string;
  mistakesHead: string;
  mistakesTitle(n: number): string;
  wrong: string;
  extra: string;
  missed: string;
  slowestPairs: string;
  drillTitle: string;
  drillBefore: string;
  drillNow: string;
  pair: string;
  ms(n: string): string;
  drillFinding(changes: readonly PairChange[], format: (n: number) => string): string | null;
  summary(wpm: string, accuracy: string, what: string): string;
  mode: {
    time(seconds: number, language: string): string;
    words(count: number, language: string): string;
    quote(language: string): string;
    custom: string;
    drill(pairs: readonly string[]): string;
  };
  languageName: { en: string; pt: string };
  progress: {
    title: string;
    emptyTitle: string;
    emptyBody: string;
    emptyAction: string;
    paceUnit: string;
    timeTyped: string;
    runs: string;
    fasterThan(percent: number): string;
    toDecade(distance: string, target: number): string;
    paceDefinition: string;
    fewRuns(n: number, needed: number): string;
    fewRunsBody(remaining: number): string;
    insight(i: MonthInsight, wpm: string): string;
    trend(wpm: string, up: boolean, since: string): string;
    paceChart: string;
    legendPace: string;
    paceChartLabel: string;
    runOfMany(n: number): string;
    legendRun: string;
    paceFewNote: string;
    paceNote(byDay: boolean, target: number): string;
    decadeLabel(target: number): string;
    runNumber(n: number): string;
    paceRead(pace: string): string;
    runRead(wpm: string): string;
    paceDay(runs: number, best: string): string;
    dayRuns(runs: number): string;
    accuracyChart: string;
    accuracyRange(low: string, high: string): string;
    accuracyWeeks(low: string, high: string, weeks: number): string;
    accuracyEvery(value: string): string;
    accuracyDotsNote: string;
    accuracyNote(weeks: number): string;
    accuracyLabel: string;
    weekOf(day: string, weeks: number): string;
    weekRead(runs: number, q1: string, q3: string, low: string, high: string): string;
    weekSpan(q1: string, q3: string): string;
    weekHead: string;
    medianHead: string;
    middleHalfHead: string;
    daysTitle: string;
    daysFinding(year: number, month: number): string;
    calendarLabel(year: number): string;
    monthHead: string;
    daysHead: string;
    less: string;
    more: string;
    dayRead(day: string, runs: number, ms: number): string;
    pairsFinding(pair: string, cost: number, format: (n: number) => string): string | null;
    drillThese: string;
    bestsTitle: string;
    test: string;
    when: string;
    today: string;
    duration(ms: number): string;
    bestLabel(mode: string, amount: number, pack: string | null, mods: string): string;
    languageSwitch: string;
  };
}

const quoted = (s: string) => `“${s}”`;

function listOf(items: readonly string[], and: string): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${and} ${items.at(-1)}`;
}

/** The same run always reads the same, while different runs vary. */
function pick<T>(seed: string, options: readonly [T, ...T[]]): T {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return options[hash % options.length] ?? options[0];
}

const en: ReportStrings = {
  locale: "en",
  wpm: "wpm",
  accuracy: "accuracy",
  raw: "raw",
  consistency: "consistency",
  rollover: "rollover",
  enterKey: "enter",
  tabKey: "tab",
  newWords: "new words",
  drill: (pairs) => `drill ${listOf(pairs, "and")}`,
  drillAgain: "drill again",
  noDrillWords: "No word on the list holds those pairs.",
  copySummary: "copy summary",
  copied: "copied",
  copyFailed: "couldn't copy",
  bestChange(diff, sign) {
    if (sign === 0) return "Level with your best.";
    return sign > 0 ? `Up ${diff} from your best.` : `${diff} under your best.`;
  },
  allWrongLetters: "No letter came out right, so this test scores 0.",
  allWrongWords: "No word came out right, so this test scores 0.",
  diagnosis(d, seed) {
    const cost = Math.round(d.costWpm);
    switch (d.kind) {
      case "nothing-notable":
        return null;
      case "slow-pairs": {
        const pairs = listOf(d.pairs.map(quoted), "and");
        return d.pairs.length === 1
          ? pick(seed, [`${pairs} cost you about ${cost} wpm.`, `Your slowest pair was ${pairs}. It cost about ${cost} wpm.`])
          : pick(seed, [`${pairs} slowed you most, by about ${cost} wpm.`, `Most of your lost time went into ${pairs}, ${cost} wpm between them.`]);
      }
      case "error-prone-letters": {
        const letters = listOf(d.letters.map(quoted), "and");
        return pick(seed, [`${letters} went wrong most often. Fixing ${d.letters.length === 1 ? "it" : "them"} cost ${cost} wpm.`, `Mistakes on ${letters} took ${cost} wpm off this test.`]);
      }
      case "hesitation-before-long-words": {
        const gap = Math.round(d.gapMs);
        return pick(seed, [`Each long word took ${gap} ms longer to start, ${cost} wpm in all.`, `You pause ${gap} ms longer before long words, which adds up to ${cost} wpm.`]);
      }
      case "too-much-correction":
        return pick(seed, [`${d.corrections} corrections cost about ${cost} wpm.`, `You went back ${d.corrections} times. Without that, you'd be ${cost} wpm faster.`]);
    }
  },
  mapTitle: "Each word, by speed",
  mapLabel: (slowest) => (slowest.length > 0 ? `The words you typed, coloured by speed. Slowest: ${slowest.join(", ")}.` : "The words you typed, coloured by speed."),
  under: (n) => `under ${n}`,
  speedTitle: "Speed",
  speedFinding(f) {
    switch (f.kind) {
      case "slowed":
        return `Held until second ${f.second}, then ${f.wpm} wpm slower.`;
      case "dipped":
        return `Slowed from second ${f.from} to ${f.to}, then recovered.`;
      case "sped-up":
        return `Slower for the first ${f.second} seconds, then ${f.wpm} wpm faster.`;
      case "steady":
        return f.spread > 0 ? `Steady throughout, within ${f.spread} wpm.` : "Steady throughout.";
    }
  },
  speedLabel: (seconds) => `Speed over ${seconds} seconds.`,
  seconds: (n) => `${n} s`,
  speedRead: (wpm) => `${wpm} wpm`,
  speedReadSecond: (second, mistakes) => (mistakes === 0 ? `second ${second}` : `second ${second}, ${mistakes === 1 ? "1 mistake" : `${mistakes} mistakes`}`),
  legendSpeed: "speed, 5 s average",
  legendEachSecond: "each second",
  legendMistake: "mistake",
  speedShortNote: "Each dot is one second.",
  secondHead: "second",
  speedAverageHead: "wpm, 5 s average",
  mistakesHead: "mistakes",
  mistakesTitle: (n) => (n === 0 ? "No mistakes" : n === 1 ? "1 mistake" : `${n} mistakes`),
  wrong: "wrong",
  extra: "extra",
  missed: "missed",
  slowestPairs: "Slowest pairs",
  drillTitle: "The pairs you drilled",
  drillBefore: "before",
  drillNow: "now",
  pair: "pair",
  ms: (n) => `${n} ms`,
  drillFinding(changes, format) {
    const parts: string[] = [];
    for (const c of changes) {
      if (c.verdict === "unknown" || c.nowMs === null) continue;
      const gap = format(Math.abs(c.nowMs - c.beforeMs));
      if (c.verdict === "same") parts.push(`${quoted(c.pair)} about the same`);
      else parts.push(`${quoted(c.pair)} ${gap} ms ${c.verdict}`);
    }
    return parts.length === 0 ? null : `${listOf(parts, "and")}.`;
  },
  summary: (wpm, accuracy, what) => `${wpm} wpm, ${accuracy} accuracy, ${what}. thefastypist`,
  mode: {
    time: (seconds, language) => `${seconds} seconds of ${language}`,
    words: (count, language) => `${count} words of ${language}`,
    quote: (language) => `a quote in ${language}`,
    custom: "my own text",
    drill: (pairs) => `drilling ${listOf(pairs, "and")}`,
  },
  languageName: { en: "english", pt: "portuguese" },
  progress: {
    title: "progress",
    emptyTitle: "Nothing typed here yet.",
    emptyBody: "Finish a test and this page starts filling in: your speed over time, your accuracy and the letter pairs that slow you down. It all stays on this device.",
    emptyAction: "start typing",
    paceUnit: "wpm pace",
    timeTyped: "time typed",
    runs: "runs",
    fasterThan: (percent) => `Faster than about ${percent}% of typists.`,
    toDecade: (distance, target) => `${distance} wpm to the ${target}s.`,
    paceDefinition: "Pace is your speed on a good day: the 80th percentile of your last 25 runs of 60 seconds on the 1k list, in the last 90 days, at 85% accuracy or better.",
    fewRuns: (n, needed) => `${n} of ${needed} runs`,
    fewRunsBody: (remaining) => `${remaining === 1 ? "1 more run" : `${remaining} more runs`} of 60 seconds on the 1k list, at 85% accuracy or better, and your Pace appears.`,
    insight(i, wpm) {
      if (i.kind === "same") return "About the same as a month ago.";
      return i.kind === "up" ? `Up ${wpm} wpm on the month before.` : `Down ${wpm} wpm on the month before.`;
    },
    trend: (wpm, up, since) => `${up ? "Up" : "Down"} ${wpm} wpm since ${since}.`,
    paceChart: "Pace",
    legendPace: "Pace",
    paceChartLabel: "Pace over time, with a dot for each run.",
    runOfMany: (n) => `${n} runs`,
    legendRun: "each run",
    paceFewNote: "Each dot is a run. The Pace line starts at the tenth.",
    paceNote: (byDay, target) => `Your Pace ${byDay ? "as each day ended" : "after each run"}, with the ${target}s dashed above it.`,
    decadeLabel: (target) => `the ${target}s`,
    runNumber: (n) => `run ${n}`,
    paceRead: (pace) => `${pace} wpm pace`,
    runRead: (wpm) => `this run, ${wpm} wpm`,
    paceDay: (runs, best) => (runs === 1 ? `1 run, ${best} wpm` : `${runs} runs, best ${best}`),
    dayRuns: (runs) => (runs === 1 ? "1 run" : `${runs} runs`),
    accuracyChart: "Accuracy",
    accuracyRange: (low, high) => (low === high ? `Every run at ${low}%.` : `Every run between ${low}% and ${high}%.`),
    accuracyWeeks(low, high, weeks) {
      // A point that covers several weeks isn't a week, so the sentence doesn't count weeks then.
      if (weeks > 1) return low === high ? `Mostly at ${low}%.` : `Mostly between ${low}% and ${high}%.`;
      return low === high ? `${low}% in most weeks.` : `Most weeks land between ${low}% and ${high}%.`;
    },
    accuracyEvery: (value) => `Every week at ${value}%.`,
    accuracyDotsNote: "Each dot is a run.",
    accuracyNote: (weeks) => (weeks === 1 ? "The line is each week's median. The band holds the middle half of that week's runs." : `The line is the median of every ${weeks} weeks, with the middle half of their runs in the band.`),
    accuracyLabel: "Accuracy over time.",
    weekOf: (day, weeks) => (weeks === 1 ? `week of ${day}` : `${weeks} weeks from ${day}`),
    weekRead(runs, q1, q3, low, high) {
      if (runs === 1) return "1 run";
      if (low === high) return `${runs} runs, all at ${low}%`;
      return q1 === q3 ? `${runs} runs, the middle half at ${q1}%` : `${runs} runs, ${q1} to ${q3}%`;
    },
    weekSpan: (q1, q3) => (q1 === q3 ? `${q1}%` : `${q1}% to ${q3}%`),
    weekHead: "week",
    medianHead: "median",
    middleHalfHead: "middle half",
    daysTitle: "Days typed",
    daysFinding: (year, month) => (month > 0 && month < year ? `${year} in the last year, ${month} of them in the last 30 days.` : `${year} in the last year.`),
    calendarLabel: (year) => `Runs per day over the last year. ${year} days typed.`,
    monthHead: "month",
    daysHead: "days typed",
    less: "less",
    more: "more",
    dayRead(day, runs, ms) {
      if (runs === 0) return `${day}: no runs`;
      const time = ms < 60_000 ? "under a minute" : `${Math.round(ms / 60_000)} min`;
      return `${day}: ${runs === 1 ? "1 run" : `${runs} runs`}, ${time}`;
    },
    pairsFinding(pair, cost, format) {
      if (cost < 0.2) return null;
      const size = cost < 1 ? `under 1` : cost % 1 >= 0.75 ? `nearly ${Math.ceil(cost)}` : `about ${format(Math.round(cost))}`;
      return `${quoted(pair)} costs ${size} wpm a run.`;
    },
    drillThese: "drill these pairs",
    bestsTitle: "Personal bests",
    test: "test",
    when: "when",
    today: "today",
    duration(ms) {
      const minutes = Math.floor(ms / 60_000);
      if (minutes === 0) return `${Math.round(ms / 1000)} s`;
      return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
    },
    bestLabel(mode, amount, pack, mods) {
      const base = mode === "time" ? `${amount} seconds` : mode === "words" ? `${amount} words` : "quote";
      const extras = [pack && pack !== "1k" ? pack : null, mods.includes("p") ? "punctuation" : null, mods.includes("n") ? "numbers" : null, mods.includes("a") ? "without accents" : null].filter(Boolean);
      return extras.length > 0 ? `${base}, ${extras.join(", ")}` : base;
    },
    languageSwitch: "Language of the runs below",
  },
};

const ptBr: ReportStrings = {
  locale: "pt-BR",
  wpm: "ppm",
  accuracy: "precisão",
  raw: "bruto",
  consistency: "constância",
  rollover: "sobreposição",
  enterKey: "enter",
  tabKey: "tab",
  newWords: "novas palavras",
  drill: (pairs) => `treinar ${listOf(pairs, "e")}`,
  drillAgain: "treinar de novo",
  noDrillWords: "Nenhuma palavra da lista tem esses pares.",
  copySummary: "copiar resumo",
  copied: "copiado",
  copyFailed: "não copiou",
  bestChange(diff, sign) {
    if (sign === 0) return "Igual ao seu melhor.";
    return sign > 0 ? `${diff} acima do seu melhor.` : `${diff} abaixo do seu melhor.`;
  },
  allWrongLetters: "Nenhuma letra saiu certa, então este teste fica em 0.",
  allWrongWords: "Nenhuma palavra saiu certa, então este teste fica em 0.",
  diagnosis(d, seed) {
    const cost = Math.round(d.costWpm);
    switch (d.kind) {
      case "nothing-notable":
        return null;
      case "slow-pairs": {
        const pairs = listOf(d.pairs.map(quoted), "e");
        return d.pairs.length === 1
          ? pick(seed, [`${pairs} custou cerca de ${cost} ppm.`, `Seu par mais lento foi ${pairs}. Custou cerca de ${cost} ppm.`])
          : pick(seed, [`${pairs} foram os que mais atrasaram, cerca de ${cost} ppm juntos.`, `A maior parte do tempo perdido foi em ${pairs}, ${cost} ppm somados.`]);
      }
      case "error-prone-letters": {
        const letters = listOf(d.letters.map(quoted), "e");
        return pick(seed, [
          d.letters.length === 1 ? `${letters} foi o que mais saiu errado. Corrigir custou ${cost} ppm.` : `${letters} foram os que mais saíram errados. Corrigir custou ${cost} ppm.`,
          `Os erros em ${letters} tiraram ${cost} ppm deste teste.`,
        ]);
      }
      case "hesitation-before-long-words": {
        const gap = Math.round(d.gapMs);
        return pick(seed, [`Cada palavra longa levou ${gap} ms a mais para começar, ${cost} ppm no total.`, `Você hesita ${gap} ms a mais antes de palavras longas, e isso soma ${cost} ppm.`]);
      }
      case "too-much-correction":
        return pick(seed, [`${d.corrections} correções custaram cerca de ${cost} ppm.`, `Você voltou ${d.corrections} vezes. Sem isso, estaria ${cost} ppm mais rápido.`]);
    }
  },
  mapTitle: "Cada palavra, por velocidade",
  mapLabel: (slowest) => (slowest.length > 0 ? `As palavras que você digitou, coloridas por velocidade. Mais lentas: ${slowest.join(", ")}.` : "As palavras que você digitou, coloridas por velocidade."),
  under: (n) => `abaixo de ${n}`,
  speedTitle: "Velocidade",
  speedFinding(f) {
    switch (f.kind) {
      case "slowed":
        return `Firme até o segundo ${f.second}, depois ${f.wpm} ppm mais lento.`;
      case "dipped":
        return `Desacelerou do segundo ${f.from} ao ${f.to} e depois retomou o ritmo.`;
      case "sped-up":
        return `Mais lento nos primeiros ${f.second} segundos, depois ${f.wpm} ppm mais rápido.`;
      case "steady":
        return f.spread > 0 ? `Constante do início ao fim, numa faixa de ${f.spread} ppm.` : "Constante do início ao fim.";
    }
  },
  speedLabel: (seconds) => `Velocidade ao longo de ${seconds} segundos.`,
  seconds: (n) => `${n} s`,
  speedRead: (wpm) => `${wpm} ppm`,
  speedReadSecond: (second, mistakes) => (mistakes === 0 ? `segundo ${second}` : `segundo ${second}, ${mistakes === 1 ? "1 erro" : `${mistakes} erros`}`),
  legendSpeed: "velocidade, média de 5 s",
  legendEachSecond: "cada segundo",
  legendMistake: "erro",
  speedShortNote: "Cada ponto é um segundo.",
  secondHead: "segundo",
  speedAverageHead: "ppm, média de 5 s",
  mistakesHead: "erros",
  mistakesTitle: (n) => (n === 0 ? "Nenhum erro" : n === 1 ? "1 erro" : `${n} erros`),
  wrong: "errada",
  extra: "a mais",
  missed: "pulada",
  slowestPairs: "Pares mais lentos",
  drillTitle: "Os pares que você treinou",
  drillBefore: "antes",
  drillNow: "agora",
  pair: "par",
  ms: (n) => `${n} ms`,
  drillFinding(changes, format) {
    const parts: string[] = [];
    for (const c of changes) {
      if (c.verdict === "unknown" || c.nowMs === null) continue;
      const gap = format(Math.abs(c.nowMs - c.beforeMs));
      if (c.verdict === "same") parts.push(`${quoted(c.pair)} quase igual`);
      else parts.push(`${quoted(c.pair)} ${gap} ms mais ${c.verdict === "faster" ? "rápido" : "lento"}`);
    }
    return parts.length === 0 ? null : `${listOf(parts, "e")}.`;
  },
  summary: (wpm, accuracy, what) => `${wpm} ppm, ${accuracy} de precisão, ${what}. thefastypist`,
  mode: {
    time: (seconds, language) => `${seconds} segundos de ${language}`,
    words: (count, language) => `${count} palavras de ${language}`,
    quote: (language) => `uma citação em ${language}`,
    custom: "meu próprio texto",
    drill: (pairs) => `treinando ${listOf(pairs, "e")}`,
  },
  languageName: { en: "inglês", pt: "português" },
  progress: {
    title: "progresso",
    emptyTitle: "Nada digitado aqui ainda.",
    emptyBody: "Termine um teste e esta página começa a se preencher: sua velocidade ao longo do tempo, sua precisão e os pares de letras que atrasam você. Tudo fica neste aparelho.",
    emptyAction: "começar a digitar",
    paceUnit: "ppm de ritmo",
    timeTyped: "tempo digitado",
    runs: "testes",
    fasterThan: (percent) => `Mais rápido que cerca de ${percent}% de quem digita.`,
    toDecade: (distance, target) => `${distance} ppm para chegar aos ${target}.`,
    paceDefinition: "Ritmo é a sua velocidade num dia bom: o percentil 80 dos seus últimos 25 testes de 60 segundos na lista 1k, nos últimos 90 dias, com precisão de 85% ou mais.",
    fewRuns: (n, needed) => `${n} de ${needed} testes`,
    fewRunsBody: (remaining) => `${remaining === 1 ? "Mais 1 teste" : `Mais ${remaining} testes`} de 60 segundos na lista 1k, com precisão de 85% ou mais, e seu ritmo aparece.`,
    insight(i, wpm) {
      if (i.kind === "same") return "Quase igual a um mês atrás.";
      return i.kind === "up" ? `${wpm} ppm acima do mês anterior.` : `${wpm} ppm abaixo do mês anterior.`;
    },
    trend: (wpm, up, since) => `${up ? "Subiu" : "Caiu"} ${wpm} ppm desde ${since}.`,
    paceChart: "Ritmo",
    legendPace: "ritmo",
    paceChartLabel: "Ritmo ao longo do tempo, com um ponto para cada teste.",
    runOfMany: (n) => `${n} testes`,
    legendRun: "cada teste",
    paceFewNote: "Cada ponto é um teste. A linha do ritmo começa no décimo.",
    paceNote: (byDay, target) => `Seu ritmo ${byDay ? "ao fim de cada dia" : "depois de cada teste"}, com a casa dos ${target} tracejada acima.`,
    decadeLabel: (target) => `casa dos ${target}`,
    runNumber: (n) => `teste ${n}`,
    paceRead: (pace) => `${pace} ppm de ritmo`,
    runRead: (wpm) => `neste teste, ${wpm} ppm`,
    paceDay: (runs, best) => (runs === 1 ? `1 teste, ${best} ppm` : `${runs} testes, o melhor com ${best}`),
    dayRuns: (runs) => (runs === 1 ? "1 teste" : `${runs} testes`),
    accuracyChart: "Precisão",
    accuracyRange: (low, high) => (low === high ? `Todos os testes em ${low}%.` : `Todos os testes entre ${low}% e ${high}%.`),
    accuracyWeeks(low, high, weeks) {
      if (weeks > 1) return low === high ? `Quase sempre em ${low}%.` : `Quase sempre entre ${low}% e ${high}%.`;
      return low === high ? `${low}% na maioria das semanas.` : `Quase toda semana fica entre ${low}% e ${high}%.`;
    },
    accuracyEvery: (value) => `Todas as semanas em ${value}%.`,
    accuracyDotsNote: "Cada ponto é um teste.",
    accuracyNote: (weeks) => (weeks === 1 ? "A linha é a mediana de cada semana. A faixa guarda a metade central dos testes dela." : `A linha é a mediana de cada ${weeks} semanas, com a metade central dos testes na faixa.`),
    accuracyLabel: "Precisão ao longo do tempo.",
    weekOf: (day, weeks) => (weeks === 1 ? `semana de ${day}` : `${weeks} semanas a partir de ${day}`),
    weekRead(runs, q1, q3, low, high) {
      if (runs === 1) return "1 teste";
      if (low === high) return `${runs} testes, todos em ${low}%`;
      return q1 === q3 ? `${runs} testes, a metade central em ${q1}%` : `${runs} testes, de ${q1} a ${q3}%`;
    },
    weekSpan: (q1, q3) => (q1 === q3 ? `${q1}%` : `${q1}% a ${q3}%`),
    weekHead: "semana",
    medianHead: "mediana",
    middleHalfHead: "metade central",
    daysTitle: "Dias digitados",
    daysFinding: (year, month) => (month > 0 && month < year ? `${year} no último ano, ${month} deles nos últimos 30 dias.` : `${year} no último ano.`),
    calendarLabel: (year) => `Testes por dia no último ano. ${year} dias digitados.`,
    monthHead: "mês",
    daysHead: "dias digitados",
    less: "menos",
    more: "mais",
    dayRead(day, runs, ms) {
      if (runs === 0) return `${day}: nenhum teste`;
      const time = ms < 60_000 ? "menos de 1 min" : `${Math.round(ms / 60_000)} min`;
      return `${day}: ${runs === 1 ? "1 teste" : `${runs} testes`}, ${time}`;
    },
    pairsFinding(pair, cost, format) {
      if (cost < 0.2) return null;
      const size = cost < 1 ? `menos de 1` : cost % 1 >= 0.75 ? `quase ${Math.ceil(cost)}` : `cerca de ${format(Math.round(cost))}`;
      return `${quoted(pair)} custa ${size} ppm por teste.`;
    },
    drillThese: "treinar estes pares",
    bestsTitle: "Melhores marcas",
    test: "teste",
    when: "quando",
    today: "hoje",
    duration(ms) {
      const minutes = Math.floor(ms / 60_000);
      if (minutes === 0) return `${Math.round(ms / 1000)} s`;
      return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
    },
    bestLabel(mode, amount, pack, mods) {
      const base = mode === "time" ? `${amount} segundos` : mode === "words" ? `${amount} palavras` : "citação";
      const extras = [pack && pack !== "1k" ? pack : null, mods.includes("p") ? "pontuação" : null, mods.includes("n") ? "números" : null, mods.includes("a") ? "sem acentos" : null].filter(Boolean);
      return extras.length > 0 ? `${base}, ${extras.join(", ")}` : base;
    },
    languageSwitch: "Idioma dos testes abaixo",
  },
};

export function reportStrings(lang: Lang): ReportStrings {
  return lang === "pt-br" ? ptBr : en;
}

/** Fixed decimals in the interface's own notation: 97.2 and 97,2. */
export function formatter(locale: string, digits: number): (n: number) => string {
  const format = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false });
  return (n) => format.format(n);
}
