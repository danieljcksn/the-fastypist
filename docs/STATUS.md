# Status

On 2026-11-11 Daniel chose to go live first, as a guest-only typing test: accounts off, no database, no cron. `vercel.json` no longer holds deploys, so every push to `main` deploys `thefastypist.vercel.app`, and the Next.js site serves there now. The ranking pages are on `main` too and stay closed until accounts turn on.

## Works today

Run it with `npm run dev` (port 3390). Every push to `main` is a production deploy, so a push must pass lint, typecheck, unit tests and the build first.

- The typing test in English and Portuguese: time, words, quote and custom modes, dead keys, sound, settings.
- Results, device history, `/progress`, drills and the pace caret.
- Charts on results and progress, as DESIGN.md's Charts section describes.
- `/about`, `/privacy`, `/terms`, `/word-lists`, the 404, error pages, metadata, robots, sitemap, security headers, share images.
- The server domain and route handlers, tested on PGlite only.
- `/today` with Standings, `/u/[username]`, `/r/[id]`, their share images, reports, held-run review and `/admin`. With accounts off the public ones say rankings aren't open yet and carry `noindex`, none is in the header or the sitemap, `/admin` and the account APIs answer 404, and a guest build ships none of their client code.
- Sign-in, welcome and settings pages, and the ranked client flow. These stay off until both Clerk keys exist, and have never run against a real session.
- CI on every push and pull request, Dependabot, and a README.

## Checks at this commit

Run on 2026-11-11 against `d2538b5` plus the lint and test fixes after it, with `VERCEL_ENV=production`, `NEXT_PUBLIC_SITE_URL=https://thefastypist.vercel.app` and no database URL.

- `npm run typecheck`, `npm run lint`: clean.
- `npm test`: 1322 passed, 4 skipped. The 4 need a real database.
- `node scripts/db-migrate.mjs && next build`: passes. The migrate step says nothing was migrated because accounts are off.
- `npm run test:e2e`: 123 passed, 4 skipped, 3 failed, in Chromium only. The sound test failed on the analytics path that only Vercel serves, and passes now that the test answers it. The other two remain:
  - `budget.spec.ts`, twice: on a production build `/` loads 195.8 KB and `/pt-br` 196.1 KB, against 185 with a limit of 194.25. A build without `VERCEL_ENV` measures 193.9 and 194.2 and passes, because only production starts analytics. Its chunk adds 1.8 KB at idle, and on Vercel its script adds another 2.3 KB, so the live `/` measured 201.1 KB the same way. Decide whether analytics at idle counts as first load, then cut weight or settle the budget.
- `progress.spec.ts:178`, no layout shift on a returning typist's page, passed this run but fails about 2 runs in 8 under heavy load, on older commits too.

## What's left, in order

1. **Weight.** The two budget failures above. Known cuts: Speed Insights code still ships in the analytics chunk though its flag is off, about 0.4 KB in the 404 payload, about 0.5 KB of ticket code for guests. The framework is about 134 KB of what remains.
2. **Boards.** The pages are on `main` and have never run against a real session or database. `/progress` still needs account data added.
3. **Reviews that never ran.** The attack on the ranked flow, and the cut-off dead key fix in real Firefox and Safari. Check every defect in `private/resume/research/bugs.md` is gone.
4. **Repo chores.** Dependabot alert #26, esbuild 0.18.20 through `drizzle-kit`, dev toolchain only. Dependabot's `@types/node` pull request, the-fastypist#5, waits on a green CI run.
5. **Boards cutover.**
   - Put back `"crons": [{ "path": "/api/cron/daily", "schedule": "5 6 * * *" }]` in `vercel.json`, removed for the guest launch because without a database or `CRON_SECRET` it could only fail every day.
   - Create Neon on the Vercel Marketplace in `aws-us-east-1`, capped at 0.25 CU.
   - Set `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `TICKET_SECRETS`, `DAILY_SECRET`, `PLAUSIBILITY` (from `private/plausibility.json`), `CRON_SECRET`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, the Clerk webhook signing secret, `NEXT_PUBLIC_CONTACT_URL`. Accounts turn on only with both Clerk keys, and from then on a build with no database URL fails.
   - Bump `drizzle/production-watermark.txt` in the same commit.
   - Confirm a new deployment really exists: Vercel has silently skipped a push on this account before.
   - Tag `d7a660d`.

## Waiting on Daniel

- **Clerk secret:** paste it after `CLERK_SECRET_KEY=` in `.env.local`, which git ignores. It reached the session truncated. The publishable key is already there.
- **Domain:** `fastypist.com` or `thefastypist.com`, about $12 a year, available on 2026-11-06. The current keys are a development instance: 100 users, a "Development mode" label, and accounts that don't move to production.
- **Clerk dashboard:** turn on GitHub sign-in. Production needs its own Google and GitHub OAuth apps.
- **Choices:** a repo licence, since none is set. A lawyer's read of `/privacy` and `/terms`. Vercel Pro before any public announcement, because Hobby pauses on overage. Sound on or off by default, which is off today. Whether idle analytics counts against the weight budget.
- **Ear test:** nobody has listened to the key sounds yet.
- **Real devices:** Safari, iOS, Android GBoard, Windows ABNT2 and a screen reader are all untested.

## Resuming

`docs/PLAN.md` and `docs/DESIGN.md` still rule. `private/resume` exists only on the original workstation and holds the research reports, the design and chart mocks, and the workflow scripts. Those scripts name a scratch folder that will be gone, so treat them as briefs: read one, repoint its paths, and run it again. Only one `next build` at a time per checkout.
