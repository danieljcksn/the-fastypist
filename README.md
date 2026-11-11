# thefastypist

A typing test that opens ready to type. There is no sign-up, no start button and no ads: the clock starts on your first letter, and the result is one large number with a sentence on what to practise next.

The interface and the words both come in English and Brazilian Portuguese, and you can mix them.

## What it does

- Time runs of 15, 30, 60 or 120 seconds, word runs of 10, 25, 50 or 100, public domain quotes, or your own text. Punctuation and numbers are toggles.
- Word lists of 200, 1,000 and 5,000 common words in each language. Accents typed with dead keys count as one letter.
- Results with speed, accuracy, raw speed and consistency, your text coloured by how fast you typed each word, speed over time, mistakes by kind and the letter pairs that cost you the most.
- One key turns those pairs into a drill of real words built around them.
- A pace caret that races your own best.
- History that stays in your browser, and a progress page with your Pace, accuracy, the days you typed and your personal bests.
- Key sounds synthesized in the browser, off until you turn them on.

## How scoring works

Every score is computed by replaying the run's keystroke log, never from counters kept while you type. Speed and accuracy are whole numbers of hundredths, reached with only addition, subtraction, multiplication, division and rounding, so every JavaScript engine gets the same result to the bit. A golden file in `tests/unit/engine` pins it.

**Speed** counts the letters of the words you got right, plus their spaces, at 5 characters to a word. A word left with a mistake in it adds nothing. The word you were typing when time ran out counts as far as you got, as long as every letter so far is right.

**Raw** counts every character you typed, right or wrong, in the same unit. **Accuracy** is the share of keys that were right when you pressed them, so a mistake you fix still counts against it. **Consistency** compares your speed across stretches of 20 keys: 100 when they are all equally fast, lower as they spread apart.

**Pace**, on the progress page, is your speed on a good day: the 80th percentile of your last 25 runs of 60 seconds on the 1k list in the past 90 days, at 85% accuracy or better. The percentile beside it places Pace on a curve fitted to a published study of 168,000 typists, and is approximate.

## Running it

With Node 22:

```sh
npm ci
npm run dev
```

Then open http://localhost:3390. No environment variables are needed: without them you get the whole test, and history stays in the browser.

To run what CI runs:

```sh
npm run lint
npm run typecheck
npm test
npx next build
npx playwright install chromium
npm run test:e2e
```

The end-to-end tests run in Chromium against the production build, never the dev server.

## Where things are

- `docs/PLAN.md` holds the scope and every ruling, and wins over anything else.
- `docs/DESIGN.md` is the design contract for anything that renders.
- `docs/STATUS.md` says where the work stands and what comes next.
- `AGENTS.md` covers how to work in this repository.

The code that decides a score or a text lives in `src/engine`. The typing surface in `src/typing` writes to the page directly, so no keystroke passes through React. Routes are in `src/app`, with English at `/` and Portuguese at `/pt-br`.

## Credits and licences

The word lists are adapted from [FrequencyWords](https://github.com/hermitdave/FrequencyWords) by Hermit Dave, under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), and the adapted lists are released under the same licence. [`src/engine/packs/ATTRIBUTION.md`](src/engine/packs/ATTRIBUTION.md) records the source, the corpus and what was changed.

The quotes are in the public domain: every author died by 1955, and every work was first published before 1931. The texts come from [Project Gutenberg](https://www.gutenberg.org) and [Wikisource](https://pt.wikisource.org), and the word lists page credits each one.

[Red Hat Text and Red Hat Mono](https://github.com/RedHatOfficial/RedHatFont), Copyright 2021 The Red Hat Project Authors, are under the [SIL Open Font License 1.1](src/app/fonts/OFL-red-hat.txt). The wordmark is drawn from [Poppins](https://github.com/itfoundry/Poppins) SemiBold Italic, Copyright 2014-2019 Indian Type Foundry, under the same licence.

The percentile uses only the published summary of Dhakal, Feit, Kristensson and Oulasvirta, [Observations on Typing from 136 Million Keystrokes](https://doi.org/10.1145/3173574.3174220), CHI 2018.

No licence has been chosen for the code.
