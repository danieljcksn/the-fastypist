# Plan of record

The rebuild of thefastypist on Next.js. Decisions here were settled against reproduced bugs, measured prototypes and primary sources on 2026-11-06. Change them deliberately and say why.

Plausibility thresholds are not in this repository. They live in the `PLAUSIBILITY` environment variable.

## Product

A typing test that opens ready to type. No sign-up, no clicks, no ads. Open the page and start. It tells you what to practise next, and it ranks you honestly when you ask it to.

Keep from the old app: the wordmark (lowercase italic with one green `t`), the dark ground, the 60-second default, no start button, anonymous by default, space commits and moves on, one large number as the result, lowercase interface wording.

## Scope

### Typing, no account needed

- Modes: time 15, 30, 60 (default), 120 s. Words 10, 25, 50, 100. Quote (public domain passages). Custom text. Punctuation and numbers as unranked toggles.
- Word lists: English and Brazilian Portuguese at 200, 1k and 5k. 1k is the default and the ranked list.
- Input: real dead keys and accents on ABNT2 and US-International, phone keyboards, Caps Lock warning, lost-focus state.
- Feedback: per-letter state, three caret shapes, extra letters shown, optional live speed, optional pace caret from your own best.
- Sound: three synthesized profiles with volume, error sound, release sound and stereo spread. Off by default, one click on.
- Results: speed, accuracy, raw, consistency, personal best change, one-sentence diagnosis, rhythm map (the text coloured by latency), speed chart, error types, rollover, weakest letter pairs.
- Drill: one key from the diagnosis to a real-word drill on your weakest pairs.
- History on the device, progress page included, moved to your account as private history when you sign up.
- Settings: at most 12.
- English and pt-BR interface, independent of the word language.

### Accounts

Clerk. Google, GitHub and email code. Sign-in pages are full pages. A username is only asked for when someone opts into ranking.

### Ranking

- **Today:** the main board. One shared 60 s text per language, one attempt, spent when the text is revealed. New text at 06:00 UTC. Guests get yesterday's text and see where they would have placed. Spoiler-free share string.
- **Standings:** ranked by Pace. Hidden until 20 eligible typists exist on a list.
- **Pace:** 80th percentile of your last 25 ranked runs in 90 days, in WPM. Listed from 10 runs.
- **Percentile:** against a permanent published reference (Dhakal et al. 2018), labelled approximate.
- **Eligibility:** signed in, username, ranking consent, frozen list, 60 s, unused ticket, replay passed, accuracy at least 85%, physical keyboard, not held.
- Public profile `/u/[username]`, result permalink `/r/[id]`, OG images.
- Reports, hold queue, retype to confirm, `/admin`.
- Export and delete.

### Never

XP, levels, badges, leagues, streak counters, nudges, fake players, ads, funboxes, joke sound packs, hold-time storage, rhythm-based account matching.

### Next, not in this rebuild

Code mode, beat-me links, private live rooms, command palette, keyboard heatmap, PWA, Spanish, tier labels, weekly and monthly boards (when Today regularly passes 50 a day), an all-time fastest board (at 1,000 Standings members).

## Rulings

Where research disagreed, these won.

| Topic | Ruling |
| --- | --- |
| Next | 16.4.5, `cacheComponents` on, `partialPrefetching` on. TypeScript 6.0.3: typescript-eslint rejects 7. |
| Activity trap | With `cacheComponents`, pages stay hidden-mounted. Engine state lives in a `useEffect` closure and its cleanup clears the DOM. `key={bfcacheId}` restores stale state on browser back. |
| `/` | Static (`ensureStatic`), outside the proxy matcher, no provider, no database, no tickets, no network wait on the key path. Must work with Clerk, the database and analytics all down. |
| Clerk loading | A client gate reads `__client_uat`. Guests never load Clerk. Signed-in visitors load the island on idle, never during a run, otherwise at test end. `prefetchUI={false}`. |
| Clerk navigation | Reach `/sign-in` and `/sign-up` with `<a href>`, not `<Link>`. Wrap `<SignIn />` in `<Suspense>`. Never put server `<Show>` or `auth()` in the root layout. |
| Proxy matcher | `/api`, `/me`, `/settings`, `/welcome`, `/admin`, `/sign-in`, `/sign-up`, `/__clerk`. `/u` is static with no `auth()`. Passthrough when Clerk keys are absent. |
| Submit auth | Bearer token to a Route Handler. `userId: null` means retry with a fresh token, not guest. Results queue in a local outbox. |
| Username | Our own column, null until first opting into ranking. Clerk's username attribute off. Lazy upsert is the source of truth, webhook updates never insert, weekly reconcile. Hard delete. |
| Input | Hidden `<input>`. Cancel `beforeinput` on real keys, diff the value for composition and virtual keyboards. `keydown.timeStamp` is the only timebase. `translate="no"` and `data-gramm="false"` on the surface. |
| Rendering | Five rows, patched through refs by `className`. No React on keystrokes. Monospace only, caret by arithmetic. |
| Timer | `performance.now` deadline, `requestAnimationFrame` display. Score always from `replay()`. Hidden tab aborts; on Today hidden ends the attempt. Keep the seed on restart only with zero keys typed. |
| Keystroke log | Binary, versioned, frozen before the first ranked run. Carries char, space, backspace, word delete, dead key, keydown delta and keyup hold. Holds are sent, checked, discarded. |
| PRNG | xoshiro128++ with Lemire reduction, no repeat within the last 3 words. Permanent. |
| Word packs | Immutable, content-addressed, all versions kept in the server bundle. Pack and `scorer_version` go on every ticket and result. |
| Tickets | Stateless HMAC, no database write, no guest tickets, no user in the ticket. The user is bound at submit. Single use by primary key. |
| Timing checks | Fire-and-forget start and end stamps. Judge stamps, not arrival, because retries are legitimate. A late stamp downgrades, never rejects. |
| Status words | `passed`, `held`, `voided`, `unverified`, plus `reviewed_at`. |
| Holds | Quarantine, never reject, except integrity failures. Board-size triggers apply only from 1,000 entries. No auto-bans. No shadow bans. |
| Keystroke retention | Raw logs stay on the device. Ranked logs are verified in memory and discarded. Held and top-10 flight times kept 30 days. Ranking asks separate consent. |
| Columns | `integer` for centi-WPM. `results` carries seed, scorer version, body hash and device class. `daily_challenges` stores each day's seed. No FK on `result_id` referrers. Indexes use `.desc().nullsFirst()`. |
| Tie-break | Composite (`wpm_cx`, `accuracy_bp`), not an encoded single number. |
| Database | Neon, `pg` with `attachDatabasePool`, `db.transaction`. Autoscale capped at 0.25 CU. Writes on submit only, `revalidateTag(tag,'max')` from the handler, 1 h timer. Local outbox covers outages. |
| Build | Migrate before `next build`, with an advisory lock, only when `VERCEL_ENV==='production'`. Readers catch database failures so a deploy succeeds with the database down. |
| Sound | Pre-rendered by plain JS DSP into 25 buffers, 6 voice strips, 8 ms gap, WaveShaper soft clip, never `DynamicsCompressor`. Sound off means no audio chunk, no `AudioContext`, no console warning. `press()` runs first in the keydown handler. `Process` / 229 counts as a key. |
| Keymap | One table owns every shortcut. |
| Weight | About 185 KB total on `/` first load. The mono font is the only preload. |
| i18n | `/` English, `/pt-br` Portuguese, hreflang, `<html lang>` from the route. No auto-redirects. |
| Licences | `src/pages/Main/words.js` is a copy of a GPL list and goes. Word data from FrequencyWords (CC BY-SA 4.0) with an attribution page. Icons are our own. No repo licence until Daniel picks one. |

## Build order

1. Design contract (`docs/DESIGN.md`) and tokens.
2. Replace Vite with Next, shipping a bare page.
3. Engine: core, score, replay, log, PRNG, generation, with property tests and golden vectors.
4. Word packs.
5. Typing surface, results, settings, sound, local history.
6. Database, tickets, verification.
7. Accounts.
8. Today, Standings, profiles, progress, moderation.
9. i18n, legal, SEO, errors, brand.
10. E2E against the production build, latency budgets, accessibility, adversarial review.
11. Provision, switch Vercel, merge, deploy, verify live.
