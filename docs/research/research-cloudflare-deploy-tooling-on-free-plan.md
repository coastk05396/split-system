# Research: Cloudflare deploy tooling on the free plan (小芽分帳)

All facts below were read on **2026-10-28** from primary sources (Cloudflare developer docs, Drizzle docs, GitHub docs, the npm registry and the tools' own repositories). "Unconfirmed" means the source did not state it and I did not guess. Doc pages were read through a summarising fetcher, so exact wording should be re-checked before relying on it for anything critical.

Base URL shorthand: `CF` = https://developers.cloudflare.com

## 1. Wrangler config, custom domain with static assets, preview vs production

- Wrangler accepts `wrangler.json`, `wrangler.jsonc` or `wrangler.toml`. JSON support arrived in Wrangler v3.91.0. Cloudflare recommends `wrangler.jsonc` for new projects, and some newer features work only with JSON. Source: CF/workers/wrangler/configuration/ (2026-10-28).
- `compatibility_date` is required (yyyy-mm-dd). `assets` has `directory`, `binding`, `run_worker_first`, `html_handling`, `not_found_handling`. Only one asset collection per Worker. Same source.
- SPA fallback: `assets.not_found_handling = "single-page-application"`. With the Cloudflare Vite plugin the `assets.directory` is filled in automatically from the client build output, and `assets` is only needed for routing options. Source: CF/workers/vite-plugin/reference/static-assets/ (2026-10-28).
- By default (`run_worker_first` false) a request matching a static asset is served directly and the Worker only runs when no asset matches. Source: CF/workers/static-assets/binding/ (2026-10-28).
- Static asset requests are free and unlimited and do not count toward the 100k/day Worker limit. Caveat: with `run_worker_first = true`, matching requests invoke the Worker and, once the free limit is exceeded, get a 429. Negative patterns (`!/...`) still serve assets without invoking the Worker. Source: CF/workers/static-assets/billing-and-limitations/ (2026-10-28).
- Custom domain: add a route with `custom_domain = true` (JSONC: `"routes": [{ "pattern": "split.rickchen.si", "custom_domain": true }]`) then `wrangler deploy`, or use dashboard Workers & Pages > Settings > Domains & Routes. Requirements: active zone on Cloudflare; the hostname must not already have a CNAME record. Cloudflare creates the DNS record and an Advanced certificate automatically. Wildcards not supported. The same mechanism applies to a Worker that serves static assets (assets are part of the Worker). Sources: CF/workers/configuration/routing/custom-domains/ and the wrangler configuration page (2026-10-28).
- Environments: `env.<name>` blocks, selected with `--env`/`-e` or `CLOUDFLARE_ENV` (the Vite plugin uses only `CLOUDFLARE_ENV`). Each environment deploys as a separate Worker named `<name>-<env>`. Bindings, `vars` and secrets are not inherited and must be repeated per environment. Cloudflare says to use environments for persistent staging/dev Workers, and Previews for per-branch or per-PR URLs. Source: CF/workers/wrangler/environments/ (2026-10-28).
- Version URLs: `wrangler versions upload` returns a Version URL (optional `--preview-alias`); it uses the version's existing configuration and resources, so a D1 binding points at whatever database the config names (production unless changed; the page does not name D1, so this is inference). Version URLs run only on `workers.dev`, are public unless protected with Cloudflare Access, and are not generated for Workers that use Durable Objects. Free-plan availability of Version URLs is **unconfirmed** on that page. Source: CF/workers/configuration/previews/ (2026-10-28).
- Previews (newer feature, `wrangler preview`, needs Wrangler >= 4.135.0): per-branch isolated deployment with its own URL, vars, secrets and bindings. The limits table has a Free column: 100 Previews per Worker on Free, 100 deployments per Preview. D1/KV/R2 are isolated only if the Preview binds a separate resource; routes and Cron Triggers always target production. Config lives in a `previews` block, which does not inherit production settings; `assets`, `compatibility_date`, `compatibility_flags` stay top level only. A separate D1 is declared by repeating the binding name under `previews`. Explicit "available on Free" wording is **unconfirmed** (inferred from the limits table). Sources: CF/workers/previews/, /previews/get-started/, /previews/configuration/ (2026-10-28).

Illustrative snippet (not application code):

```jsonc
{
  "name": "split",
  "main": "apps/worker/src/index.ts",
  "compatibility_date": "<today>",
  "assets": { "directory": "apps/web/dist", "not_found_handling": "single-page-application" },
  "routes": [{ "pattern": "split.rickchen.si", "custom_domain": true }],
  "d1_databases": [{ "binding": "DB", "database_name": "split-prod", "database_id": "<PROD_ID>", "migrations_dir": "drizzle" }],
  "env": { "staging": { "d1_databases": [{ "binding": "DB", "database_name": "split-staging", "database_id": "<STAGING_ID>", "migrations_dir": "drizzle" }] } }
}
```

## 2. D1 migrations with Drizzle Kit; separate preview and production databases

- Drizzle D1 getting-started: install `drizzle-orm`, `drizzle-kit`; `drizzle.config.ts` with `dialect: 'sqlite'`, `driver: 'd1-http'`, `dbCredentials` (accountId, databaseId, token); `drizzle-kit generate` writes SQL and snapshots into `out` (`./drizzle`); `drizzle-kit migrate` applies them; `drizzle-kit push` applies the schema directly without files. The Wrangler config sets `migrations_dir = "drizzle"` so Wrangler can read the same folder. Source: https://orm.drizzle.team/docs/get-started/d1-new (2026-10-28).
- Package tags on the npm registry (2026-10-28): `drizzle-orm` latest = **0.45.4** (published 2026-10-08), tag `rc` = 1.0.0-rc.5. `drizzle-kit` latest = **0.31.11** (2026-09-21), tag `rc` = 1.0.0-rc.5. The Drizzle D1 page tells you to install `@rc`, while the stable tag is still 0.x. This is a decision point (stable 0.x vs rc). Source: https://registry.npmjs.org/drizzle-orm and /drizzle-kit.
- The Drizzle `migrate` page documents the migrations log table `__drizzle_migrations` and `--config=` for multiple configs (suggested for separate dev/prod DBs), but does not mention `d1-http` or Wrangler. Source: https://orm.drizzle.team/docs/drizzle-kit-migrate (2026-10-28).
- Wrangler path: `wrangler d1 migrations create|list|apply`. `apply <DB> --local` targets the local SQLite in `.wrangler/state`; `--remote` targets the deployed database; `--preview` targets a preview DB. The confirmation prompt is skipped in non-interactive CI; a backup is taken; a failed migration is rolled back and earlier ones stay applied. State table default `d1_migrations`; folder default `migrations/` (override `migrations_dir`). Sources: CF/workers/wrangler/commands/d1/, CF/d1/reference/migrations/, CF/d1/tutorials/d1-and-prisma-orm/ (2026-10-28).
- Resulting workflow (inference; both tools read the same SQL folder): `drizzle-kit generate` (no credentials needed) -> `wrangler d1 migrations apply <db> --local` for dev and tests -> `wrangler d1 migrations apply <db> --remote` in CI. This avoids giving Drizzle Kit an account token. Whether Drizzle's generated SQL and numbering work cleanly with Wrangler's migration tracking is **unconfirmed** (no doc describes this combination), so test it once.
- Separate databases: create two D1 databases (`wrangler d1 create`), then use either `env.staging.d1_databases` (separate Worker `split-staging`) or `previews.d1_databases`. Free plan allows 10 databases per account. Sources: CF/d1/platform/limits/, CF/workers/previews/configuration/ (2026-10-28).
- D1 free: 5M rows read/day, 100k rows written/day, 5 GB total storage; reset 00:00 UTC; exceeding makes queries fail. Dashboard and Wrangler queries count. DDL may count as rows read/written (the page says "may"; migration cost **unconfirmed**). Limits: 500 MB per database, 50 queries per Worker invocation, 100 bound parameters per query, 2 MB max row. Source: CF/d1/platform/pricing/ and /limits/ (2026-10-28).

## 3. Workers test runner for Vitest

- **The package was renamed.** `@cloudflare/vitest-pool-workers` (latest 0.23.0, 2026-10-07) is deprecated on npm: "renamed to @cloudflare/vitest-plugin. This package will not receive future updates." Current: **`@cloudflare/vitest-plugin` 1.4.9** (2026-10-27), peer dependency `vitest ^4.1.0 || ^5.0.0`. Sources: https://registry.npmjs.org/@cloudflare/vitest-plugin and /@cloudflare/vitest-pool-workers (2026-10-28).
- Docs: install `vitest@^4.1.0` and the plugin as dev dependencies; config is a Vite plugin: `plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })]` in `vitest.config.ts`. Requires compatibility date 2022-10-31 or later and an ES modules Worker. Source: CF/workers/testing/vitest-integration/get-started/write-your-first-test/ (2026-10-28).
- Vitest constraint: docs say 4.1 or later; registry peers allow `^4.1.0 || ^5.0.0`. Latest vitest on the registry is 5.0.5 (2026-10-15), engines `node ^22.12.0 || ^24.0.0 || >=26.0.0`. Do not use Vitest 3 or older. Source: registry pages above.
- D1 in tests: `readD1Migrations()` (from `@cloudflare/vitest-plugin/config`, run in Node in the config) then `applyD1Migrations(db, migrations)` in a setup file; table defaults to `d1_migrations`. Storage is isolated per test file. Bindings are imported from `cloudflare:workers`. Sources: CF/workers/testing/vitest-integration/test-apis/ and /configuration/ (2026-10-28).
- Static assets: `exports.default.fetch()` tests the Worker's default handler, but `exports` does **not** expose Assets; to test assets use `startDevWorker()`. So SPA fallback is not covered by the standard integration path. Same source.
- Known issues: no native V8 coverage (use Istanbul), fake timers do not affect KV/R2/cache, dynamic `import()` fails in some handlers, WebSockets with Durable Objects unsupported with isolated storage. Source: CF/workers/testing/vitest-integration/known-issues/ (2026-10-28).
- Pure money logic in the shared package does not need the Workers runtime and can run in a plain Vitest project (inference).

## 4. Deploy options, secrets, token scopes

- **GitHub Actions + `cloudflare/wrangler-action`.** Latest release **v4.1.3** (2026-09-24) per the GitHub releases API; docs example uses `@v4`. Runs on `node24` (action.yml). Inputs: `apiToken`, `accountId`, `command` (default `deploy`; `preview` needs Wrangler >= 4.136.3), `environment`, `secrets`, `vars`, `workingDirectory`, `wranglerVersion`, `packageManager` (inferred from lockfile), `preCommands`, `postCommands`. Sources: https://github.com/cloudflare/wrangler-action (action.yml, releases) and CF/workers/ci-cd/external-cicd/github-actions/ (2026-10-28).
- GitHub Actions cost: standard GitHub-hosted runners are free in public repositories (private repos on the Free plan: 2,000 min/month). Source: https://docs.github.com/en/billing/concepts/product-billing/github-actions (2026-10-28).
- **Workers Builds** (Cloudflare Git integration): Free plan = **3,000 build minutes/month, 1 concurrent build, 20 minute timeout**, 2 vCPU, 8 GB RAM. Providers: GitHub, GitLab (also Artifacts, Cursor Origin). Root directory supports monorepos; the dashboard Worker name must match `name` in the config. Deploy command default `npx wrangler deploy`; non-production branch command default `npx wrangler preview` (or `versions upload`). Build image defaults: Node 24.22.1 (22.23.4 also preinstalled), npm 10.9.2, pnpm 10.11.1, yarn 4.18.1, Bun 1.4.4; override with `NODE_VERSION`/`PNPM_VERSION`, `.nvmrc`, or `packageManager` in `package.json`. Only user API tokens are supported for the build token. Public GitHub repo support, token minimum scopes, and whether D1 migrations can run in the build are **unconfirmed**. Sources: CF/workers/ci-cd/builds/, /limits-and-pricing/, /configuration/, /build-image/, /advanced-setups/ (2026-10-28).
- **Secrets.** Worker secrets: `wrangler secret put <KEY>` (creates a new version and deploys immediately), `wrangler secret bulk` (up to 100), `wrangler versions secret put` (no deploy), or `--secrets-file` on `deploy`/`versions upload`; the dashboard also works. Local: `.dev.vars` or `.env` (gitignored). Do not put secrets in `vars`. wrangler-action can set them via its `secrets` input mapped from `env:`. CI credentials go in repository secrets (Settings > Secrets and variables > Actions, or `gh secret set`); secrets are not passed to runs from forks. Sources: CF/workers/configuration/secrets/, CF/workers/wrangler/commands/workers/, https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets (2026-10-28).
- **Token scopes.** Cloudflare's GitHub Actions guide says the deploy token needs the "Edit Cloudflare Workers" permission scoped to the account. Permission groups listed: Workers Scripts Edit (account), D1 Edit (account), Account Analytics Read (account), Workers Routes (zone), Workers R2 Storage (account). Sources: CF/workers/ci-cd/external-cicd/github-actions/ and CF/fundamentals/api/reference/permissions/ (2026-10-28). Minimum for this app, **as an inference to verify with a test token**: Account > Workers Scripts > Edit (deploy), Account > D1 > Edit (remote migrations), Zone > Workers Routes > Edit (only if Wrangler creates the custom domain route). Whether the custom-domain route also needs a DNS or Zone Read scope is **unconfirmed**. Workers Builds' auto-generated token mentions Workers Scripts (edit) and Workers Routes (edit) (CF/workers/ci-cd/builds/configuration/).

## 5. GraphQL Analytics API and Cron Triggers

- Endpoint: `POST https://api.cloudflare.com/client/v4/graphql`; Bearer API token with **Account > Account Analytics > Read**. Sources: CF/analytics/graphql-api/ and /getting-started/authentication/api-token-auth/ (2026-10-28). The docs warn the data is not for billing and includes all measurable traffic.
- Workers requests per day: dataset `workersInvocationsAdaptive` (beta) with `sum { requests errors }` and filters `datetime_geq/leq`, `scriptName`, `accountTag`. Up to one month of data per query, for dates up to three months ago. Source: CF/analytics/graphql-api/tutorials/querying-workers-metrics/ (2026-10-28).
- D1: dataset `d1AnalyticsAdaptiveGroups` (requires `accountTag`). Docs list `rowsRead` and `rowsWritten` as metric names, but the documented examples only show `readQueries`/`writeQueries`; the exact `sum { rowsRead rowsWritten }` shape is **unconfirmed** until checked by introspection. Source: CF/d1/observability/metrics-analytics/ (2026-10-28).
- Rate limit: 300 queries per 5 minutes by default. Source: CF/analytics/graphql-api/limits/ (2026-10-28).
- **Whether these datasets are callable on a free account is unconfirmed**: none of the pages read states plan restrictions for the Workers or D1 datasets. Test with a real free-account token before depending on it. Fallback: count `meta.rows_read`/`rows_written` from D1 query results in the app, or use the dashboard.
- Cron Triggers (free): **5 per account, 10 ms CPU per invocation**; UTC; changes take up to 15 minutes to propagate; config `"triggers": { "crons": ["0 * * * *"] }`; handler `scheduled(controller, env, ctx)`; Cron Triggers do not target Previews. Sources: CF/workers/platform/limits/ and CF/workers/configuration/cron-triggers/ (2026-10-28).
- Other free limits confirmed: 100,000 requests/day, 10 ms CPU per request, 50 subrequests, 128 MB memory, 20,000 asset files per version, 25 MiB per asset (CF/workers/platform/limits/).
- R2 (optional): free tier 10 GB-month storage, 1M Class A, 10M Class B per month, free egress. Whether R2 needs a payment method on a free account is **unconfirmed**. Source: CF/r2/pricing/ (2026-10-28).

## 6. Monorepo layout and tool versions

- Cloudflare recommends pnpm workspaces for sharing dependencies across Workers and shared packages (CF/workers/ci-cd/builds/advanced-setups/, 2026-10-28). Proposed layout (my design): `apps/worker` (Hono), `apps/web` (Vite + React), `packages/shared` (Zod schemas, money logic), root `pnpm-workspace.yaml`. With the Cloudflare Vite plugin one `vite build` can produce both the Worker and the SPA assets; alternatively keep two packages and point `assets.directory` at the SPA build.
- Versions read from the npm registry on 2026-10-28:
  - wrangler **4.154.0**, engines `node >=22.0.0`
  - @cloudflare/vite-plugin **1.65.0**, peers `vite ^6.1.0 || ^7.0.0 || ^8.0.0`, `wrangler ^4.152.0`
  - vite **8.3.5**, engines `node ^20.19.0 || >=22.12.0`
  - vitest **5.0.5**, engines `node ^22.12.0 || ^24.0.0 || >=26.0.0`; @cloudflare/vitest-plugin 1.4.9 peers `vitest ^4.1.0 || ^5.0.0`
  - @vitejs/plugin-react 6.1.2, engines `node ^20.19.0 || >=22.12.0`
  - hono 4.13.14; drizzle-orm 0.45.4 and drizzle-kit 0.31.11 (stable tags)
  - pnpm 12.15.0 (engines `node >=18`); typescript 7.0.2; zod 4.6.7; react 19.3.1
  - Workers Builds image default pnpm 10.11.1 (override via `packageManager` or `PNPM_VERSION`).
- Common Node floor satisfying every tool above: **Node 22.12 or newer** (22 LTS or 24). Pin with `.nvmrc` and `engines`, and pin the package manager with an exact `packageManager` field. The Vite plugin get-started page requires `"type": "module"` and states no Node version (CF/workers/vite-plugin/get-started/).
- Caveat: I did not cross-check the registry's major versions (TypeScript 7, pnpm 12, Vitest 5) against each project's changelog; take versions from the lockfile at install time.

## Verdicts

| # | Item | Verdict | Reason |
|---|------|---------|--------|
| 1 | Wrangler config, custom domain, assets, envs | Fits | `wrangler.jsonc` plus a `custom_domain` route works with assets; static assets are free; use a staging environment or a Preview for non-production. Keep `run_worker_first` off (or negative-pattern the assets) so SPA traffic does not use the 100k/day quota. |
| 2 | Drizzle + D1 migrations, separate DBs | Fits with a change | Generate with `drizzle-kit`, apply with `wrangler d1 migrations apply` (local and remote) instead of `drizzle-kit migrate` over `d1-http`. Two D1 databases fit the 10-DB limit. Decide stable 0.x vs `rc` 1.0. |
| 3 | Vitest Workers runner | Fits with a change | Use the renamed `@cloudflare/vitest-plugin` (not `vitest-pool-workers`) with Vitest >= 4.1; asset serving cannot be tested through `exports` (use `startDevWorker()` or test only the API). |
| 4 | Deploy on free plan | Fits | GitHub Actions + `wrangler-action@v4` is free on a public repo and keeps D1 migrations in the pipeline. Workers Builds (3,000 min/month) is also free, but token scopes, public-repo behaviour and migration support are unconfirmed. |
| 5 | GraphQL usage + Cron | Fits with a change | Token scope is Account Analytics Read, but free-plan access to the Workers/D1 datasets is unconfirmed and the D1 field shape must be checked. Cron limit (5 triggers, 10 ms CPU) is fine for one daily poll. |
| 6 | Monorepo and versions | Fits | pnpm workspace, Node >= 22.12; pin exact versions. |

## Cheapest working setup

1. One Worker (Hono) plus Vite SPA built with `@cloudflare/vite-plugin`, one `wrangler.jsonc`, a `custom_domain` route for `split.rickchen.si`, `not_found_handling: "single-page-application"`, `run_worker_first` off.
2. pnpm workspace (`apps/worker`, `apps/web`, `packages/shared`), Node 22.12+ pinned, exact `packageManager`.
3. Two D1 databases (`split-prod`, `split-staging`); `drizzle-kit generate` into `drizzle/`, `migrations_dir = "drizzle"`; apply with `wrangler d1 migrations apply <db> --local|--remote`.
4. Tests: Vitest with `@cloudflare/vitest-plugin` for the Worker and D1 (`applyD1Migrations`), plain Vitest for the shared money package.
5. Deploy: GitHub Actions on a public repo. On PR: typecheck and tests. On push to `main`: remote migrations, then `wrangler deploy` via `cloudflare/wrangler-action@v4`. Repository secrets `CLOUDFLARE_API_TOKEN` (Workers Scripts Edit, D1 Edit, plus Workers Routes Edit if needed) and `CLOUDFLARE_ACCOUNT_ID`; Worker secrets via `wrangler secret put` or the action's `secrets` input.
6. Usage monitoring: one daily Cron Trigger calling the GraphQL API with a separate Account Analytics Read token, after first confirming free-plan access; otherwise count D1 `meta` rows in the app.
7. Skip R2 until needed.
