---
title: Research Cloudflare deploy tooling on the free plan
type: wayfinder:research
mode: AFK
status: closed
assignee:
parent: ../map.md
blocked_by: []
---

## Question

Primary sources only, all-free constraint, for a Hono Worker that also serves a Vite SPA as static assets, with D1 and Drizzle, a shared TypeScript package, and a custom domain `split.rickchen.si` (the zone is already on Cloudflare): (1) the current wrangler configuration format and how a custom domain is attached to a Worker with static assets, plus preview and production environments or versions; (2) the D1 migration workflow with Drizzle Kit (generate, apply locally, apply remotely, separate preview and production databases); (3) the current name, setup and limits of the Workers test runner for Vitest with D1 and static assets; (4) deploy options on the free plan: GitHub Actions with the official wrangler action versus Cloudflare Workers Builds (free build minutes and limits), how secrets are set (`wrangler secret`, repository secrets), and the minimum API token scopes; (5) whether Cloudflare's GraphQL Analytics API can be called for free to read daily Worker request counts and D1 rows read and written, which token scope it needs, and the Cron Trigger limits on the free plan; (6) a monorepo layout that keeps the Worker, the SPA and the shared packages (Zod schemas, money logic) in one repository, with the Node and package manager versions the tools require. Finish with a verdict per item and the cheapest working setup.

## Resolution

Versions below are as read by the agent on 2026-10-28; take real versions from the lockfile at install time (the agent did not cross-check registry major versions against changelogs).

1. **Wrangler config, custom domain, assets: fits.** Use `wrangler.jsonc` with a `custom_domain` route for `split.rickchen.si` and `not_found_handling: "single-page-application"`. Static asset requests are free. Keep the Worker out of the way of asset requests: either leave `run_worker_first` off or use the explicit pattern `["/api/*"]` from the hosting research, so only API calls count against the 100,000 requests a day. Use a staging environment or a Preview for non-production.
2. **Drizzle with D1 migrations: fits with a change.** Generate with `drizzle-kit`, apply with `wrangler d1 migrations apply <db> --local|--remote` (not `drizzle-kit migrate` over `d1-http`). Two D1 databases (`split-prod`, `split-staging`) fit the 10-database limit. Stable drizzle-orm is 0.45.4 while the Drizzle docs point to a 1.0 `rc` tag; pick stable unless a needed feature requires `rc`.
3. **Vitest Workers runner: fits with a change.** The package is now `@cloudflare/vitest-plugin` (not `vitest-pool-workers`) and needs Vitest 4.1 or later; static assets cannot be tested through `exports`, so test the API, and use the dev worker for anything touching assets.
4. **Deploy on the free plan: fits.** GitHub Actions with `cloudflare/wrangler-action@v4` is free on a public repo and keeps D1 migrations in the pipeline. Workers Builds also gives 3,000 build minutes a month, but its token scopes, public-repo behaviour and migration support are unconfirmed.
5. **GraphQL usage check and Cron: fits with a change.** The token scope is Account Analytics Read, but whether a free account can read the Workers and D1 datasets is unconfirmed and the D1 field shape must be checked. Cron allows 5 triggers at 10 ms CPU each, enough for one daily poll. If the analytics API is not usable, the fallback is to count D1 `meta` rows written in the app, or the weekly dashboard check.
6. **Monorepo and versions: fits.** A pnpm workspace with `apps/worker` (Hono), `apps/web` (Vite and React) and `packages/shared` (Zod schemas, money logic), Node 22.12 or newer pinned with `.nvmrc` and `engines`, and an exact `packageManager` field.

Cheapest working setup: one Worker plus the Vite SPA built with `@cloudflare/vite-plugin`; two D1 databases; tests with the Workers plugin for the Worker and D1 and plain Vitest for the shared money package; GitHub Actions that on a pull request runs the checks and on a push to `main` runs remote migrations then `wrangler deploy`, with repository secrets `CLOUDFLARE_API_TOKEN` (Workers Scripts Edit, D1 Edit, plus Workers Routes Edit if needed) and `CLOUDFLARE_ACCOUNT_ID` and Worker secrets set with `wrangler secret put`; a separate Account Analytics Read token for the daily usage check; skip R2 until needed.

Findings: branch `research/cloudflare-deploy-tooling-on-free-plan` on origin, file `docs/research/research-cloudflare-deploy-tooling-on-free-plan.md` (throwaway, never merged; the agent could not run git, so the commit was made by hand and is unsigned).
