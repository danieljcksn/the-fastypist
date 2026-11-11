# Design contract

The interface is one quiet line and a block of words. Once you type, only the words, the caret and the clock remain.

Three directions were built and judged on 2026-11-06. This is the winner with the judges' corrections applied. Anything that renders answers to this page.

## What he rejects

Uppercase or letterspaced labels. Centred heroes or results. Serif mottos. Ornaments, dividers for decoration, gradients outside chart marks, glass, glows, shadowed cards, cards inside cards, coloured left borders. Blue, purple. Emoji, confetti, badges, trophies, avatars. Em dashes in copy. Vendor names in copy (the privacy page is the one exception, as a legal disclosure). Grey-question-white-answer couplets repeated across sections: a uniform pattern across a set is what reads as machine-written.

## Colour

The portfolio's palette, at Daniel's request on 2026-11-06: Cloudflare's orange on warm ink, with greys from the same warm family. The neon green is retired, in the wordmark too. One accent: orange is the brand, the caret, the primary action and the data. Nothing else on a page competes with it, and nothing else is orange.

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `--ground` | `#0f0e0c` | `#ffffff` | Page |
| `--surface` | `#1c1a17` | `#eeece7` | Your board row, panels |
| `--rule` | `#2e2b27` | `#d8d5ce` | Chart grid only |
| `--text` | `#f6f5f2` | `#0f0e0c` | Correct letters, numbers, titles |
| `--secondary` | `#c9c5be` | `#3a3733` | Clock, mode words |
| `--pending` | `#9a958f` | `#6b6763` | Letters not yet typed. 6.50:1 and 5.61:1 |
| `--muted` | `#8f8a84` | `#6b6763` | Labels, nav, hints. At least 4.5:1 on surface |
| `--wrong` | `#ff4f79` | `#c2153f` | Wrong letters. A rose, so it never reads as the orange caret |
| `--extra` | `#ffd166` | `#8a5a00` | Extra letters, warnings |
| `--brand`, `--caret` | `#ff5e1f` | `#ff5e1f` | The `t`, the caret, the primary action, data. 6.31:1 on ink, 3.06:1 on white, so never small text on white |
| `--on-brand` | `#0f0e0c` | `#0f0e0c` | Anything on orange. White on orange only measures 3.06:1 |

Rhythm map, four tiers from fast to slow, gaining chroma at about the same lightness: dark `#9a958f`, `#d4a184`, `#f08350`, `#ff5e1f`. Light `#6b6763`, `#8f5c3c`, `#b34f1f`, `#c8440f`.

Calendar, an orange ramp on `--surface`: dark `#3a2116`, `#7a3418`, `#c24a1b`, `#ff5e1f`. Light `#ffd9c6`, `#ffab84`, `#ff7f47`, `#ff5e1f`.

## Type

Red Hat Text 400 and 500 for everything. Red Hat Mono 450 for the typing surface and the rhythm map, and nowhere else. The wordmark is an SVG drawn from Poppins SemiBold Italic, so no page loads Poppins. Self-hosted, Latin subset. The mono is the only preload and uses `display: optional`, because a late swap would re-wrap a run in progress.

| Step | Size | Use |
| --- | --- | --- |
| `--t-s` | 0.875rem | Footer, table captions |
| `--t-c` | 0.9375rem | Nav, modes, hints |
| `--t-m` | 1rem | Body, section titles (weight 500) |
| `--t-l` | 1.5rem | Diagnosis, stat values |
| `--t-xl` | 2.25rem | Page statements, `wpm` |
| `--hero` | `min(20rem, 44vw)` | The result. Three digits at 0.8 of this |

Root font size is 16 px, 18 px from 1920 wide, 20 px from 2400 wide. All numbers use `tabular-nums`. Hero letter-spacing is -0.035em.

The typing cell is a whole pixel so columns never round differently: `--ch` is 19 px on desktop, 22 px from 1920, 24 px from 2400, 13 px below 720. `--type` is `calc(var(--ch) / 0.6)`. Red Hat Mono's advance is exactly 0.6em. Row height is `--type × 1.625`, rounded to a pixel. Ligatures and kerning off.

## Grid

One column: `min(72rem, 100% - 2.5rem)`, centred, on a 20 px gutter at phone width. Backgrounds run full width, content never does.

Two vertical axes on every page: the left edge, and a line at two thirds. Anything on the right sits on that second axis. Header and footer run flush to both column edges.

Section spacing is 6rem. Title to data is 1.5rem. 8 px base.

## Letter states

Each state differs by colour and by line shape, so colour-blind typists lose nothing.

| State | Letter | Line |
| --- | --- | --- |
| Pending | `--pending` | None |
| Correct | `--text` | None |
| Wrong | `--wrong` | Solid, `--wrong` |
| Extra | `--extra` | Double, `--extra` |
| Missed | `--pending` | Dotted, `--wrong` |

Underline offset 0.32em, so `g` and `ç` stay clear. Thickness 0.0625em, skip-ink off.

Wrap lines 4 columns short of the row and cap extras at 4 per word, so nothing clips and a line never re-wraps during a run.

Caret width `max(2px, round(0.08em, 1px))`, hanging just left of the letter. Bar is the default, block and underline are options. Movement is a `transform` with a 70 ms ease. It blinks only when idle.

## Home

**Idle.** Wordmark left, `today`, `progress`, `sign in` flush right. Vertically, the block sits at about a third of the viewport.

Above the first row, on one baseline: `60` in Red Hat Text at 2rem in `--secondary`, then `seconds of english, sound off` and `settings` at `--t-c`. The words are controls. They brighten and underline on hover and focus. Below the third row, one hint: `tab for new words`, on touch `tap the words to start`.

Footer: `português` left, `about`, `privacy`, `word lists` flush right, at `--t-s` in `--muted`. On short pages it sits at the bottom with a 2.5rem margin.

**Running.** On the first letter everything except the words, the caret and the number fades over 120 ms, then becomes `visibility: hidden` with `pointer-events: none`. Boxes stay exactly where they are. The number counts down in place. Idle and running boxes must measure identical in English and Portuguese at 320, 390, 1440 and 2560.

Caps Lock warning takes the sentence's slot, in `--extra`. Lost focus: grey caret and `press any key to continue`, and the clock keeps running.

## Results

The number is the page. One integer, left, on the column edge, with `wpm` beside it at `--t-xl` in `--muted`. On the two-thirds axis, with the last baseline matching `wpm`: accuracy, raw, consistency, rollover.

Below, at `--t-l`, two lines: the personal best change in `--secondary` (`Up 3.2 from your best.`), then the diagnosis in `--text`.

Two actions, keyboard hints inside: `drill th and qu  enter` on `--brand` with `--on-brand` text, `new words  tab` plain. No personal best line appears on a first run.

6rem down, on the left measure: the rhythm map, the words you typed in Red Hat Mono coloured by tier. Letters with errors keep their tier colour and carry only the underline. The legend sits flush right on the title row: a 2 px-radius swatch in each tier's colour beside its value in `--muted` (`80+ 65+ 50+ under 50 wpm`), with thresholds at 0.95, 0.77 and 0.6 of the run's speed. On the two-thirds axis: `14 mistakes`, three specimen rows (`wrong`, `extra`, `missed`, each drawn with its own line), then `Slowest pairs` with three rows: pair in mono, a 4 px gradient bar for its cost against the costliest, and the cost in wpm.

6rem down, full width: `Speed`, as described under Charts.

Phone order: hero, diagnosis, two equal-width 48 px actions, stats, map, mistakes, pairs, chart, footer.

## Today

A statement at `--t-xl`: `Everyone types the same text today. You get one attempt.` Then the board on the left measure, with `New text in 4h 12m`, the language switch and the benchmark source on the two-thirds axis.

Rows: rank in `--muted`, username in `--text`, wpm with one decimal, accuracy in `--muted`, figures decimal-aligned. Benchmark rows have no rank and sit in value order among real rows: `Average typist 52`, `Faster than 90%: 79`, `Faster than 98%: 99`, drawn from the same reference curve as every percentile sentence. Your row is on `--surface` with a muted `you`, sticky at the bottom when off screen, with a 24 px margin. Row height at least 44 px on phones.

Counts appear only from 5 players. Zero entries: `No one has typed today's text yet.`

## Progress

Row A: Pace as the hero, stats on the axis, then `Faster than about 82% of typists.` and `2.1 wpm to the 80s.`, with a small plain definition of Pace.

Row B: `Pace` on the measure and `Accuracy` on the right third, as described under Charts. The two share a subgrid row, so their plots start on one line whatever their headings hold.

Row C: `Days typed` on the measure. `Slowest pairs` on the right third: pair, the same thin cost bar as on results, ms, cost. A text action `drill these pairs`.

Row D: `Personal bests` on the measure, with test, wpm, accuracy, when.

## Profile

Much smaller than Progress. Pace hero and stats, `Last 5 days on Today` with date, wpm, accuracy, place, and `report this profile` last.

## Charts

Daniel asked on 2026-11-06 for charts that are "truly beautiful and well designed", and on his portfolio said that charts with no explanation feel off. The language is his portfolio's, after EvilCharts (MIT), built here in plain SVG with no library. Everything lives in `src/components/charts/` and loads with results or progress only, never on `/`.

**Ground, not panels.** Both were tried on the real pages on 2026-11-11 at 1440 and 2560 in both themes. Charts sit on the ground with the page's own alignment. A `--surface` panel moves every plot 24 px inside the column edge and the two-thirds axis, so a chart's `0` no longer lines up with the hero above it; empty calendar days are `--surface` and vanish into one; and the page's other blocks, the hero, the stats and the bests table, all sit on the ground. Panels would also be cards on a page with no other cards.

**Anatomy.** A title at `--t-m` 500 in `--text`, a legend flush right on the title row when there is more than one kind of mark, a computed finding in `--secondary`, and where the encoding isn't obvious one line in `--muted` at `--t-c` on how to read it. Then the plot, 1.5rem down. Y values sit above their rules at the left, in `--muted` at `--t-s` with a knockout in the ground colour so a line passing under stays readable. Rules are `--rule`, dashed 3 3, 1 px on the half pixel; the baseline is solid. X labels run on one line under the plot: the first starts on the left edge, the last ends on the right edge, the ones between are kept while they clear each other by 16 px and give way to the end label. Labels never rotate. Every annotation is placed by `place()` against the rule labels and the other annotations, trying its candidates in order, and is left out rather than drawn over something.

**Marks.** Data is `--brand`: a 2 px line with round joins and an area under it, a vertical gradient of `--brand` from 0.42 (0.34 on light) to 0. A ring dot (4.5 px, 2 px `--brand` stroke on the ground) marks the one point a chart calls out, with its value at weight 500 in `--text`. Per-run dots behind a line are `--muted` at half opacity. A target is dashed 5 5 in `--secondary`. Mistakes are 2 by 6 px `--wrong` ticks just under the baseline. A gap of 14 days or more breaks the line and the area, and a dotted `--muted` bridge joins the two ends. Text never wears the data colour.

**Read-out.** Hover with a mouse, tap on a touch screen, or focus the chart and use the arrows, Home, End and Escape. One controller handles all three. A 1 px `--muted` hairline snaps to the nearest point, a ring marks it, and the read-out sits beside it: inverted against the ground in each theme, 4 px radius, the value at weight 500 first, then where and what in a quieter line. It turns to the left past the middle. A tap stays until the next tap. The same text goes to a polite live region, and a visually hidden table holds every value, so nothing depends on the hover.

**Motion.** Once per chart and visit, as it scrolls into view, the data layer reveals left to right: `clip-path` over 720 ms on `cubic-bezier(.22, 1, .36, 1)`. Never under reduced motion, and never when returning to a page already seen in the session. The frame measures its width with one ResizeObserver, never per frame, and every height is fixed in CSS, so nothing shifts when a chart draws.

**Speed** (results, full width, 17rem). Net speed within each second, from `secondSpeeds()`, as a centred 5 s moving average drawn as a monotone curve, which can't overshoot a point. Raw speed isn't drawn: within one second it moves in steps of 12 wpm and adds noise, not information. The line holds its first and last values out to the edges, so it runs edge to edge like the axis. The low point gets a ring and its value when the line varies by 6 wpm or more. A run under 20 s isn't averaged: each second is a dot on a short straight line, with `Too short to average, so each second is its own dot.` The read-out gives the speed, the second and its mistakes. Under 560 px wide the rules drop to three.

**Pace** (progress, the measure, 16rem). The Pace line over an area, per-run dots behind it, the next decade dashed and labelled at the right (`the 80s`), and the current Pace as a ring with its value at the end. By date once the runs span two weeks, out to today; before that, evenly by run with room for ten. Rules every 10, every 20 past a range of 80. The range fits the runs inside Tukey's far-out fences, and a run beyond them sits on the plot's edge as a hollow ring. Under ten runs there is no line: each run is a dot, and the note says the line starts at the tenth. The read-out goes by day: date, Pace, runs that day and the best.

**Accuracy** (progress, the right third, 16rem). A median line on a band holding the middle half of the runs, per week, or per several weeks so there are never more than 16 points. The range is whole percents, at least two apart, never past 100. Under three buckets it shows each run as a dot. The finding is where most buckets sit.

**Days typed** (progress, the measure). The orange ramp on `--surface`, whole-pixel squares with a 2 px radius, the spare pixels spread over the gaps so the map meets both edges of the measure. Month labels below, `less` and `more` flush right on the line under them, today outlined in `--muted`, and the hovered, tapped or focused day read out on the left of that line (`Tue 4 Nov: 6 runs, 8 min`). Under 528 px wide, the last 26 weeks.

**For the boards.** `PaceSparkline` draws Pace with no axes for a public profile. `DistributionStrip` places everyone on today's board along one speed axis with you in `--brand`, and is never shown below 5 players.

## Section titles and copy

Title at 1rem weight 500 in `--text`. A computed finding at 1rem in `--secondary` on the next line, and on charts an optional how-to-read line in `--muted`. Every chart has a title and a sentence that says how to read it or what it found.

| Section | Title | Finding |
| --- | --- | --- |
| Results map | `Each word, by speed` | None |
| Results chart | `Speed` | `Held until second 41, then 14 wpm slower.` |
| Results mistakes | `14 mistakes` | None |
| Progress chart | `Pace` | `Up 6.4 wpm since August.` |
| Progress accuracy | `Accuracy` | `Most weeks land between 96% and 97%.` |
| Progress calendar | `Days typed` | `136 in the last year.` |
| Progress pairs | `Slowest pairs` | `"th" costs nearly 3 wpm a run.` |
| Progress bests | `Personal bests` | None |

Findings are computed. When the data can't support a sentence, leave it out rather than saying something empty.

Interface wording is lowercase for controls (`today`, `new words`, `sign in`) and sentence case for sentences. Plain, short, specific. Say what matters to the typist, never how the system works. Never name a vendor. Vary sentence shapes. Portuguese follows the same rules: no travessão, no `com sucesso`, no `por favor`, numerals always.

Read every set of strings as a set before shipping it. If every title starts the same way, break it.

## Motion

Purposeful and quick. Chrome fade 120 ms. Caret 70 ms. Line advance 120 ms ease-out on the container's `translateY`. Hover colour 120 ms, only under `(hover: hover)`. Ease `cubic-bezier(0.23, 1, 0.32, 1)`. Results appear at once: the number never counts up. Under `prefers-reduced-motion`, the caret and lines snap and the fades go.

## States

Every screen designs loading, empty, error and success. A loading board shows its real rows' structure with no shift when data arrives. An unavailable board says so plainly and offers the test. A failed save keeps the run on the device and says `unsent`.

## Accessibility

Visual letters are `aria-hidden`. The input has a label and describes an sr-only copy of upcoming words, updated per word, never per letter. `role="timer"` with live off, plus a polite status at 30 s, 10 s and results. Focus ring 2 px in `--caret` with a 3 px offset. Controls are at least 44 px on phones. Tab moves natively. Works at 200% zoom and 320 px wide. `translate="no"` and `data-gramm="false"` on the surface.

## Verification

Render at 320, 390, 1440 and 2560, dark and light, and look at it. Measure box equality, overflow and contrast with a script rather than trusting the eye. A static render is not enough for the surface: type on it in the production build.
