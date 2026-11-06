# Status

Paused on 2026-11-06 at Daniel's request. Everything is on `main`. Production still serves the old Vite site, because `git.deploymentEnabled: false` in `vercel.json` holds deploys.

## Works today

Run it with `npm run dev` (port 3390), or deploy a preview from a clean copy of `main` with `vercel deploy --project thefastypist --scope daniel-s-projects-6eb7260c`.

- The typing test in English and Portuguese: time, words, quote and custom modes, dead keys, sound, settings.
- Results, device history, `/progress`, drills and the pace caret.
- The orange palette from the portfolio.
- `/about`, `/privacy`, `/terms`, `/word-lists`, the 404, error pages, metadata, robots, sitemap, security headers.
- The server domain and route handlers, tested on PGlite only.
- Sign-in, welcome and settings pages, and the ranked client flow. These stay off until both Clerk keys exist, and have never run against a real session.

## Checks at this commit

- `npm run typecheck`, `npm run lint`: clean.
- `npm test`: 1261 passed, 4 skipped. The 4 need a real database.
- `next build`: passes.
- `npm run test:e2e`: 106 passed, 3 failed, in Chromium only.
  - `budget.spec.ts`, twice: `/` first load is 208.2 KB against a 185 KB budget, and `/pt-br` is 208.5 KB. It was 191.7 KB before accounts and public pages landed, so look there first.
  - `results.spec.ts:172`: the page says `144.0 under your best.` where the test computes `143.9`. The page and the test round the gap differently. Decide which is right, don't just loosen the test.

## What's left, in order

1. **Charts.** Daniel asked for charts that are "truly beautiful and well designed". Today's are still the old thin lines, in orange. Three directions were started and stopped before judging: `private/resume/charts/{instrument,editorial,warm}`. Reference: the portfolio's `src/components/Chart.astro`. Judge them, pick one system, build it with no library, then review it in a browser.
2. **Boards.** Route handlers exist, but none of these pages do: `/today`, Standings, `/u/[username]`, `/r/[id]`, their share images, held-run messaging, reports, `/admin`. The header's `today` link gives a 404 until then. `/progress` also needs account data added.
3. **Reviews that never ran.** The browser attack and design critique on the typing surface, results and progress, and the attack on the ranked flow. Fix what they find, and check every defect in `private/resume/research/bugs.md` is gone.
4. **Failures above.**
5. **Repo chores.** `README.md` is empty and untracked. CI and Dependabot config aren't in yet: drafts are in `private/resume/scripts/fastypist-build-2-*.js` under the pages brief. The moderate `minimatch` alert is in the dev toolchain only.
6. **Cutover.**
   - Create Neon on the Vercel Marketplace in `aws-us-east-1`, capped at 0.25 CU.
   - Set `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `TICKET_SECRETS`, `DAILY_SECRET`, `PLAUSIBILITY` (from `private/plausibility.json`), `CRON_SECRET`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, the Clerk webhook signing secret, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_CONTACT_URL`.
   - Switch the project: `vercel project update thefastypist --scope daniel-s-projects-6eb7260c --framework nextjs --node-version 22.x --fluid-compute on --yes`.
   - Bump `drizzle/production-watermark.txt`, and remove `git.deploymentEnabled` in the commit that goes live.
   - Confirm a new deployment really exists: Vercel has silently skipped a push on this account before.
   - Close the-fastypist#1, #3 and #4, tag `d7a660d`, and set the repo's description and homepage.

## Waiting on Daniel

- **Clerk secret:** paste it after `CLERK_SECRET_KEY=` in `.env.local`, which git ignores. It reached the session truncated. The publishable key is already there.
- **Domain:** `fastypist.com` or `thefastypist.com`, about $12 a year, available on 2026-11-06. The current keys are a development instance: 100 users, a "Development mode" label, and accounts that don't move to production.
- **Clerk dashboard:** turn on GitHub sign-in. Production needs its own Google and GitHub OAuth apps.
- **Choices:** a repo licence, since none is set. A lawyer's read of `/privacy` and `/terms`. Vercel Pro before any public announcement, because Hobby pauses on overage. Sound on or off by default, which is off today.
- **Ear test:** nobody has listened to the key sounds yet.
- **Real devices:** Safari, iOS, Android GBoard, Windows ABNT2 and a screen reader are all untested.

## Resuming

`docs/PLAN.md` and `docs/DESIGN.md` still rule. `private/resume` exists only on the original workstation and holds the research reports, the design and chart mocks, and the workflow scripts. Those scripts name a scratch folder that will be gone, so treat them as briefs: read one, repoint its paths, and run it again. Only one `next build` at a time per checkout: `private/resume/scripts/snapbuild.sh` builds a copy in its own folder.
