---
title: Decide the deploy pipeline
type: wayfinder:grilling
mode: HITL
status: closed
assignee: rick
parent: ../map.md
blocked_by: ["16-decide-api-contract.md", "30-research-cloudflare-deploy-tooling-on-free-plan.md"]
---

## Question

Decide how the app reaches Cloudflare for free: repo layout (one repo, how the shared schema package is placed), wrangler environments (preview and production), D1 migrations with Drizzle Kit, where each secret lives (token signing key, LINE channel secret, LINE channel access token, Google client ID) and how it is set without entering the repo, the GitHub Actions workflow and its free-minutes cost, and how `split.rickchen.si` is attached to the Worker. Also confirm the current name and setup of the Workers test runner that the testing strategy relies on, and how the release checklist for Google, LINE and LIFF behaviour is kept. Also confirm whether Cloudflare's analytics API is free for the daily usage check, what API token scope it needs and where that token lives, and set up the one WAF rate rule on `/api/v1/auth/*`.

## Blocked by

- [Decide the API contract](16-decide-api-contract.md)
- [Research Cloudflare deploy tooling on the free plan](30-research-cloudflare-deploy-tooling-on-free-plan.md)

Re-wired: this ticket no longer waits on **Confirm the domain and LINE console names**, because the part that mattered (the zone being on Cloudflare) is confirmed. It is decided so that the R2 binding, the LIFF scope and the Google settings are conditional on that checklist's results, which are applied when they arrive.

## Resolution

- **Repo layout:** one repo with a pnpm workspace: `apps/worker` (the Hono API), `apps/web` (the Vite and React app) and `packages/shared` (the Zod schemas and the money logic). The web app is built into the Worker's static assets with Cloudflare's Vite plugin and one `wrangler.jsonc` configures it. Node 22.12 or newer is pinned in `.nvmrc` and `engines`, with an exact `packageManager` field; real package versions come from the lockfile at install time.
- **Environments and deploys:** two cloud environments. Production is the Worker at `split.rickchen.si` with the database `split-prod`; staging is a separate Worker on a free `workers.dev` address with `split-staging`, for trying real LINE and Google. GitHub Actions runs the deploys (not Cloudflare's own builds), because it keeps migrations in one pipeline and is free on a public repo. A pull request runs the checks only; a push to `main` runs the migrations on staging and then deploys staging; production is deployed by a manual workflow run on the same commit.
- **Database migrations:** `drizzle-kit generate` writes migrations into `drizzle/` and CI applies them with `wrangler d1 migrations apply` before each deploy. A migration is never edited after it merges and each comes with a test. Backups use D1's own point-in-time restore; how many days the free plan keeps is not confirmed and is checked at the first deploy. CI never exports production data, because the repo is public and any artifact would expose it.
- **Secrets and tokens:** GitHub repository secrets hold only `CLOUDFLARE_API_TOKEN` (Workers Scripts Edit and D1 Edit, plus Workers Routes Edit if needed) and `CLOUDFLARE_ACCOUNT_ID`. Worker secrets, set per environment with `wrangler secret put`, hold the token signing key, the LINE channel secret and the LINE channel access token. Public values (the LIFF ID, the LINE Login channel ID and the Google client ID) live in `wrangler.jsonc`. Local secrets live in a git-ignored `.dev.vars` that gitleaks also guards. The daily usage check uses its own token (Account Analytics Read) stored as a Worker secret. Rotating the signing key signs everyone out, which is accepted.
- **Domain and the rate rule:** only production has the custom domain, as a route for `split.rickchen.si` in `wrangler.jsonc`. The one WAF rate rule on `/api/v1/auth/*` is set in the Cloudflare dashboard (it is not confirmed that the config file can hold it) and is written into the release checklist.
- **Release checklist:** a short manual list in `docs/release-checklist.md`, run before each production release: LINE sign-in inside the LINE app, Google sign-in on Chrome, the LIFF share picker, "send to chat" from a group chat, the Bot webhook signature, the privacy and terms pages live, the WAF rule on, the usage check's token working, and the point-in-time restore window noted.
- **Conditional on the console checklist:** the R2 binding (only if enabling R2 needs no card), the `chat_message.write` scope, Google In production status, and the usage check (if the analytics API is not free, the weekly dashboard check replaces it). None of these blocks local work.
