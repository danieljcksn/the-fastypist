# thefastypist

A typing test on Next.js. Read these before changing anything:

- `docs/PLAN.md`: scope and every ruling. It wins over anything else.
- `docs/DESIGN.md`: the design contract for anything that renders.
- `docs/STATUS.md`: where the work stands and what's next. Start here when resuming.

## Working here

- Daniel asked for commits as work completes, pushed directly to `main`. No pull requests.
- Commit one verified unit at a time. Stage explicit paths and commit them with `git commit -m "..." -- <paths>`, so someone else's staged work never slips in. Never `git add -A`, `git commit -a`, rebase, reset or force-push. Conventional Commits, body wrapped at 72 columns, no AI attribution trailers.
- Comments state only what the code can't: a trap, a measurement, an external constraint or a decision.
- `src/engine/{core,score,replay,log,prng,generate,layout,day}.ts` decide scores and texts and must agree to the bit on every JS engine. A golden file pins them. Packs and the log format are immutable.
- Keystrokes never go through React. Nothing on the key path waits on the network.
- With `cacheComponents` on, pages stay hidden-mounted. Run state lives in an effect closure and its cleanup clears the DOM.
- Automatic deploys are held by `git.deploymentEnabled` in `vercel.json` until the cutover commit removes it.

## Commands

`npm run dev` (port 3390), `npm test`, `npm run test:e2e` (needs `next build` first, runs against the production build), `npm run lint`, `npm run typecheck`.

One `.next` folder and a shared machine: run one build and one browser at a time.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
