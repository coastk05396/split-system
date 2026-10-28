# Research: Cloudflare hosting for Vite SPA + Hono API

All facts below were read on 2026-10-28 from Cloudflare developer docs (primary source). Pages were fetched through a summarizing fetcher, so wording in quotes is as returned by it; re-verify exact figures before committing to a design.

## 1. Pages vs Workers static assets

- Pages overview says "Start new projects with Workers" and calls Workers "Cloudflare's primary platform for building applications". It does not describe Pages as deprecated or in maintenance mode. https://developers.cloudflare.com/pages/ (read 2026-10-28)
- Static assets and Worker code deploy in one operation; an `assets` binding lets Worker code serve files after handling `/api/*` itself. https://developers.cloudflare.com/workers/static-assets/ (read 2026-10-28)
- `not_found_handling: "single-page-application"` returns `index.html` with 200 for unmatched paths; `run_worker_first` accepts route patterns such as `["/api/*"]`. Same URL.
- Pages migration guide: Workers has "a distinctly broader set of features". Workers-only: Vite plugin, gradual deployments, Workers Logs, Tail Workers, Cron Triggers, source maps. Pages-only: custom domains whose nameservers are not on Cloudflare. SPA fallback must be set explicitly on Workers; static assets are served before the Worker by default. https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/ (read 2026-10-28)
- Billing: "Requests to static assets are free and unlimited"; only Worker-invoking requests are billed. Caveat: requests matching `run_worker_first` always invoke the Worker and, past free limits, get 429 instead of falling back to assets. https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/ (read 2026-10-28)
- Not confirmed: whether Pages will receive new features or has any sunset date (no statement found).

## 2. Free-tier limits (small scale)

Workers (https://developers.cloudflare.com/workers/platform/limits/, read 2026-10-28):
- 100,000 requests/day (reset 00:00 UTC); 10 ms CPU per request; 128 MB memory; 50 subrequests per invocation; 6 simultaneous outgoing connections.
- Static assets: 20,000 files per version, 25 MiB per file.
- Over the daily limit: error 1027 (route can fail open or closed).

D1 (https://developers.cloudflare.com/d1/platform/limits/ and https://developers.cloudflare.com/d1/platform/pricing/, read 2026-10-28):
- Free: 5,000,000 rows read/day, 100,000 rows written/day, 5 GB total storage, 10 databases, 500 MB per database, 50 queries per Worker invocation, 7-day Time Travel.
- Over the daily read/write limit, queries fail until reset at 00:00 UTC. A `db.batch()` counts as one query against the per-invocation limit.
- Row/string/BLOB max 2 MB; query duration max 30 s.

KV (https://developers.cloudflare.com/kv/platform/limits/, read 2026-10-28):
- Free: 100,000 reads/day, 1,000 writes/day (different keys), 1 write/sec to the same key, 1 GB storage, 25 MiB value, 512 B key.
- Delete and list limits: unconfirmed (not listed on that page).

Implication at a few thousand users: 100k Worker requests/day and 1,000 KV writes/day are the first walls; D1 writes (100k rows/day) are next. Not confirmed: KV pricing page cross-check.

## 3. ctx.waitUntil

Source: https://developers.cloudflare.com/workers/runtime-apis/context/ and https://developers.cloudflare.com/workers/platform/limits/ (read 2026-10-28)
- The runtime keeps executing promises passed to `waitUntil()` after the response is returned. Un-awaited promises not passed to it "can be canceled when the invocation ends".
- Time: up to 30 seconds after the response is sent or the client disconnects; the budget is shared across all `waitUntil()` calls in the request. Pending work after that is cancelled and logged: "waitUntil() tasks did not complete within the allowed time after invocation end and have been cancelled."
- Failures: a rejected promise does not stop other `waitUntil()` promises. Behavior of waitUntil work when the handler throws: unconfirmed (docs do not say).
- Durability: none stated. Work is best-effort, in-isolate, and lost if cancelled or the isolate dies; no retry. Docs recommend Queues for work that cannot finish in time (not available in this project's constraints).
- CPU limits (10 ms on Free) still apply to the work; waiting on network I/O does not count as CPU.

## Recommendation

- Serve the SPA as Workers static assets with the Hono API in the same Worker (`not_found_handling: single-page-application`, `run_worker_first: ["/api/*"]`); Cloudflare now directs new projects to Workers.
- Keep Pages only if a custom domain must stay on non-Cloudflare nameservers.
- Budget for the free tier: 100k Worker requests/day and KV's 1,000 writes/day will bind first; plan to move to Workers Paid before launch.
- Use `waitUntil` only for best-effort work (cache fills, logging) under 30 s; anything that must not be lost (balances, settlement) belongs in the D1 write before responding.
