# Free-plan abuse protection and observability for the 小芽分帳 Worker

Read date for every source below: 2026-10-28. Primary sources only (Cloudflare, LINE, Google developer docs). Items marked UNCONFIRMED could not be verified in the page text I could retrieve. "Inference" marks my own reasoning, not a documented fact. No application code in this file.

## 1. Abuse protection

### 1.1 WAF rate limiting rules (Free plan)
Source: https://developers.cloudflare.com/waf/rate-limiting-rules/ (availability table), read 2026-10-28.
- Number of rules: 1.
- Counting characteristic: IP only; custom counting expressions: No.
- Counting period: 10 s. Mitigation timeout: 10 s.
- Action behavior: "Perform action during mitigation period." Throttling is not available.
- Expression fields on Free: Path, Verified Bot. So a rule can match a path such as `/api/v1/auth/` by Path (matching must be exact/consistent: https://developers.cloudflare.com/waf/rate-limiting-rules/best-practices/).
- Which specific actions (Block vs challenge) Free may pick: UNCONFIRMED. The docs only use Block as the generic example and say customers on Free/Pro/Business cannot choose a duration for challenge actions (https://developers.cloudflare.com/waf/rate-limiting-rules/parameters/). Custom response is Pro and above (https://developers.cloudflare.com/waf/rate-limiting-rules/create-zone-dashboard/).
- Applies to Worker traffic on the zone's custom domain: UNCONFIRMED. The Custom Domains page (https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) says nothing about WAF. Workers metrics note that "requests blocked by WAF or other security features aren't counted" in Worker requests (https://developers.cloudflare.com/workers/observability/metrics-and-analytics/), which suggests blocked requests never reach the Worker and so do not spend the 100k/day (inference).
- Consequence: one rule, one IP counter, 10 s window. Best use: a single rule on Path starting with `/api/v1/auth/`; it cannot also cover other paths unless the expression ORs them into the same rule.

### 1.2 Turnstile (Free)
Source: https://developers.cloudflare.com/turnstile/plans/ , read 2026-10-28.
- Up to 20 widgets per account, 10 hostnames per widget, unlimited challenges (verification requests).
- Not on Free: any-hostname widgets, ephemeral IDs, offlabel (branding removal). Analytics lookback 7 days.
- Token valid 300 s, single use; siteverify is `POST https://challenges.cloudflare.com/turnstile/v0/siteverify`; no siteverify rate limit documented (https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).
- Cost: one subrequest per verified login/join (Workers Free allows 50 subrequests per invocation, https://developers.cloudflare.com/workers/platform/limits/). No D1 rows.

### 1.3 Counting in the Worker itself
- KV: only the 1,000 writes/day given in the task; a per-request counter in KV is unusable.
- Workers Rate Limiting binding: periods of 10 or 60 s only; counts are local to the Cloudflare location and approximate; docs recommend Durable Objects for strict global limits (https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/). Whether it is available/free on the Free plan: UNCONFIRMED (the page and the Workers pricing page do not say).
- Cache API: contents do not replicate outside the originating data center; works on custom domains; 50 cache calls per request share the subrequest quota; `put` only for GET responses and honors Cache-Control (https://developers.cloudflare.com/workers/runtime-apis/cache/). Usable only as an approximate per-colo counter (inference); no write quota documented.
- D1 counter cost (counting rules: https://developers.cloudflare.com/d1/platform/pricing/): Free = 5,000,000 rows read/day and 100,000 rows written/day. A counter upsert per checked request is about 1 row written (plus 1 more if the key column has an index, per the doc's index rule; a TEXT primary key normally creates one: inference) and about 1 row read when looked up by key. If counted on every API request, writes could consume up to the whole 100k budget, since Workers allows 100k requests/day. Counting only auth/join/write endpoints at, say, 5,000 such requests per day costs about 5,000 to 10,000 rows written (5 to 10 percent) and about 5,000 read. Exceeding daily limits makes D1 queries error until 00:00 UTC.

## 2. Observability (free)
- Workers Logs: included on Free; 200,000 events/day, 3-day retention; `head_sampling_rate` 0 to 1 (default 1); 256 KB log data per request (https://developers.cloudflare.com/workers/observability/logs/workers-logs/ , https://developers.cloudflare.com/workers/platform/pricing/ , limits page above). Change: from 2026-12-01 Free moves to Cloudflare Observability pricing: shared logs+traces pool of 0.5 GB/day ingestion, 7-day retention, ingestion stops at the daily cap and resumes 00:00 UTC (https://developers.cloudflare.com/observability/pricing/).
- Traces: 7-day retention (https://developers.cloudflare.com/workers/observability/traces/). Free availability and per-day event limit: UNCONFIRMED before 2026-12-01; the Observability pricing page puts traces in the Free 0.5 GB/day pool after that date.
- `wrangler tail`: live console/exception feed, filters (`--status`, `--method`, `--ip`, `--search`, `--sampling-rate`); sampling mode drops messages at high traffic; max 10 concurrent viewers; not stored (https://developers.cloudflare.com/workers/wrangler/commands/workers/ , https://developers.cloudflare.com/workers/observability/logs/real-time-logs/). Free-plan availability not stated, no Free restriction appears (UNCONFIRMED explicitly).
- Workers metrics: requests, errors (script threw, exceeded resources, internal error), CPU time quantiles, up to 3 months back; GraphQL-backed (https://developers.cloudflare.com/workers/observability/metrics-and-analytics/). Free availability not stated (UNCONFIRMED).
- D1 metrics: query volume, latency, rows read/written, storage, 31-day retention; query insights via `d1QueriesAdaptiveGroups` GraphQL or experimental `wrangler d1 insights` (https://developers.cloudflare.com/d1/observability/metrics-analytics/). Free availability UNCONFIRMED. Each query also returns exact rows read/written in its result metadata, so the Worker can log them itself.
- Alerting: the notification catalog lists no Workers or D1 error/usage alert for Free; Usage Based Billing notifications need Pro or higher and are for Pay-as-you-go (https://developers.cloudflare.com/notifications/notification-available/). Free there: incident/maintenance status, HTTP DDoS, Universal SSL, etc. So no documented free alert for nearing the 100k request or D1 row limits (a Worker over limit returns Error 1027, resets 00:00 UTC; D1 returns daily-limit errors). Possible workaround (inference, not a documented product): the Worker itself checks its own counters and pushes a LINE message to the owner; it costs requests/rows and is unverified.

## 3. Third-party rate limits
- LINE Messaging API (https://developers.line.biz/en/reference/messaging-api/ , Rate limits section): 2,000 req/s for all endpoints not listed (reply message is not listed, so 2,000/s); multicast, membership, coupon 200/s; loading animation 100/s; rich menu list 10/s; short-lived token issue 370/s. Over the limit returns 429 "The API rate limit has been exceeded." (The page is 698k characters; I read the first 100k, where this section was found.) Monthly push-message quotas depend on the OA plan and were not researched; the Bot is reply-only.
- LINE Login verify: thresholds "are not disclosed"; do not load-test; excess returns 429 (https://developers.line.biz/en/reference/line-login/). Endpoints `POST https://api.line.me/oauth2/v2.1/verify` (ID token) and `GET .../verify?access_token=` (access token).
- Google ID token: no `tokeninfo` quota documented; docs say tokeninfo is for development/debugging and recommend local verification with Google public keys (JWK/PEM), honoring `Cache-Control` for rotation (https://developers.google.com/identity/gsi/web/guides/verify-google-id-token). Quota number: UNCONFIRMED.

## Verdicts
| Item | Verdict |
|---|---|
| WAF rate limiting (1 rule, IP, 10 s/10 s) | Fits with a change: one rule only, aimed at `/api/v1/auth/*`; coverage of Worker custom-domain traffic UNCONFIRMED, verify after enabling |
| Turnstile on login/join | Fits (20 widgets, unlimited verifications) |
| Worker-side per-IP/user counting | Fits with a change: D1 only on auth/write paths (about 1-2 rows written per check); never KV |
| Workers Logs / wrangler tail / metrics / D1 metrics | Fits (200k events, 3-day retention now; 0.5 GB/day, 7 days from 2026-12-01) |
| Alerts for errors or nearing limits | Does not fit: no documented free notification |
| LINE reply, LINE verify, Google verify | Fits: 2,000/s for reply; verify limits undisclosed; verify Google tokens locally |

## Cheapest free setup
1. Turnstile on login and join; verify server-side once per token.
2. The single WAF rate limiting rule on Path `/api/v1/auth/`; confirm it triggers for the Worker route.
3. Optional D1 per-user counters on write endpoints only.
4. Verify Google ID tokens locally with cached public keys; LINE ID token verify only at login.
5. Keep Workers Logs on with sampling, log D1 row meta, review the dashboard regularly; accept no automatic alert.
