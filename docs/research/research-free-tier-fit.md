# Research: does the free tier alone carry v1 of 小芽分帳?

Date read for every source below: 2026-10-28 (all fetched that day). Workload assumed: 500 users, 100 Groups, about 50 Expenses/day, 20 LINE notifications/day. Only first-party pages are cited. "Unconfirmed" marks anything a primary page did not state.

## Verdicts

| Service | Verdict | Cheapest free change |
|---|---|---|
| Cloudflare Workers (requests, subrequests) | Fits | None |
| Workers CPU (10 ms) for the exact partition search | Does not fit as designed | Run the search in the browser, or cap the exact search at a small n and use a greedy fallback |
| Workers CPU for ES256 verify + JWT sign | Likely fits (unconfirmed, not measured) | Use WebCrypto, not pure-JS crypto |
| D1 free | Fits | Add indexes on lookup columns; write with `db.batch()` |
| LINE OA free plan, Taiwan | Does not fit for push | Stop pushing; use Reply API (not counted) and user-initiated share links; keep any push as a rare opt-in |
| Google Identity Services | Fits (no price stated; unconfirmed in writing) | None |
| Workers Static Assets | Fits | Use `run_worker_first: ["/api/*"]` so SPA navigations skip the Worker |

## 1. Cloudflare Workers free plan

- Requests: 100,000/day, resets at 00:00 UTC. CPU: 10 ms per HTTP request. Subrequests: 50 per request on Free (10,000 paid); 1,000 to internal services. Memory 128 MB. Bundle 64 MiB. 6 simultaneous outgoing connections. 5 Cron Triggers per account. Source: https://developers.cloudflare.com/workers/platform/limits/ (read 2026-10-28).
- Pricing page repeats 100,000 requests/day and 10 ms CPU per invocation; subrequests are not billed. https://developers.cloudflare.com/workers/platform/pricing/ (2026-10-28). The exact over-limit behavior for requests is not stated on this page (unconfirmed there).
- CPU time excludes waiting on `fetch()`, KV and database queries. Exceeding it returns Error 1102 "Worker exceeded resource limits". https://developers.cloudflare.com/workers/platform/limits/#cpu-time (2026-10-28).
- Request load: 500 users at an assumed 50 API calls/user/day is about 25,000/day, under 100,000. The per-user call count is my assumption. Static asset requests do not count (section 5).
- Subrequests: one Frankfurter fetch per day, a few D1 queries per request, and one LINE API call are far below 50. D1 queries have a separate cap of 50 per invocation on Free (section 2).
- Exact zero-sum-partition search over 20 balances: the standard bitmask DP is O(2^n * n), about 21 million steps at n = 20. I measured about 78 ms in Node (V8) on this machine (my own scratch benchmark, not a primary source; Workers uses V8 too, so expect the same order of magnitude). That is roughly 8 times the 10 ms budget. A naive 3^n subset enumeration is worse. Verdict: does not fit at n = 20. It likely fits for small n (n up to about 14 is roughly 1/64 of the work, unconfirmed on Workers hardware).
- ES256 verify and JWT sign: the WebCrypto page lists ECDSA sign/verify as supported but does not name P-256 specifically ("believed to be fully supported"). https://developers.cloudflare.com/workers/runtime-apis/web-crypto/ (2026-10-28). Per-operation CPU cost is not published, so fit is unconfirmed; native WebCrypto ECDSA P-256 operations are normally well under 10 ms, but I did not measure it. `jose` uses WebCrypto on Workers (not verified here). Test with a Worker before launch.
- Cron: the cron page gives no free-plan or CPU detail and defers to the limits page (5 per account). https://developers.cloudflare.com/workers/configuration/cron-triggers/ (2026-10-28). The daily FX fetch can be a cron or lazy on first request.

## 2. D1 free plan

- Rows read 5,000,000/day; rows written 100,000/day; storage 5 GB per account. Reset 00:00 UTC. Rows read counts rows scanned, so an unindexed filter scans the whole table; each index on a written column adds a written row; row size does not matter. https://developers.cloudflare.com/d1/platform/pricing/ (2026-10-28). Exceeding returns errors until reset.
- Limits: 10 databases, 500 MB per database, 50 queries per Worker invocation on Free; a `db.batch()` counts as one query toward that cap; 100 bound parameters per query. https://developers.cloudflare.com/d1/platform/limits/ (2026-10-28).
- Fit: 50 Expenses/day, each with about 5 split rows and 2 to 3 indexes, is roughly 50 x 6 x 3 = 900 written rows/day, about 1% of 100,000 (my estimate). The daily FX write is 1 row. A batch Expense write uses one batch call, under the 50-query cap, with each statement bound to 100 parameters or fewer. Reads: with indexes, balances for a Group are a few hundred rows per call; without indexes every call scans full tables. 5 million is ample if indexed.
- Group size caution: reading all Expenses of a Group to compute balances on each request grows with history; keep a per-Group index.

## 3. LINE Official Account (Taiwan)

- Counting rule: messages are counted by number of recipients, not by message objects. A push with four message objects to a five-person chat counts as 5. Blocked or nonexistent users are not counted. Reply messages are not counted; push, multicast, broadcast and narrowcast are. https://developers.line.biz/en/docs/messaging-api/pricing/ and https://developers.line.biz/en/docs/messaging-api/sending-messages/ (2026-10-28).
- Messaging API has no separate fee; cost comes from the OA plan. Over the limit the API returns an error and messages are not sent. Same pricing page.
- Taiwan plans (excluding tax). The developers pricing page gives no Taiwan figures and defers to tw.linebiz.com. https://tw.linebiz.com/column/LINEOA-2026-Price-Plan/ (2026-10-28):
  - Light (輕用量): NT$0, 200 free messages/month, no add-ons.
  - Medium (中用量): NT$800, rising to NT$1,000 on 2026-11-01, 3,000 messages, no add-ons.
  - High (高用量): NT$1,200, rising to NT$1,400 on 2026-11-01, 6,000 messages; add-ons NT$0.2 each up to 50,000 then NT$0.15.
  - The free plan is therefore Light with 200 messages/month. The Light plan fee and quota are unchanged by the November change. The page does not state how group-chat pushes count in Taiwan; that comes only from the developers page above (per recipient). Group counting in Taiwan is the developers rule, not confirmed on a tw.linebiz page.
- Not counted per tw.linebiz: 1-on-1 chat, auto-reply, welcome messages, and the Messaging API Reply API. https://tw.linebiz.com/service/account-solutions/line-official-account/ (2026-10-28). Counting day uses Japan time (GMT+9) per the same page.
- Cost of the workload: 20 notifications/day x 30 = 600 pushes/month. Each Flex push to a group counts once per member. For a 5-member group that is 3,000 messages/month; even 1 recipient each is 600. Against 200 free messages that is exhausted in about 10 days at best (1 recipient) or 2 days (5 members). Does not fit.
- LIFF and LINE Login: the LIFF overview and LINE developers FAQ state no fees, and neither says "free" explicitly. https://developers.line.biz/en/docs/liff/overview/ and https://developers.line.biz/en/faq/ (2026-10-28). Treat as no stated fee, unconfirmed as an explicit free guarantee.
- Not confirmed: whether LIFF `shareTargetPicker` or `liff.sendMessages` (user-initiated) count against the OA quota. I did not find a primary statement; do not rely on it until checked.
- Cheapest free change: replace server push with (a) Reply API replies when a user messages the bot, (b) user-initiated share links from LIFF, (c) in-app pending list shown when the user opens the LIFF. Keep push only for rare events under about 200 recipients per month, with a counter that stops sending before the cap.

## 4. Google Identity Services

- The overview and client-ID setup pages describe Web application client IDs and consent screen setup and give no pricing or quota. https://developers.google.com/identity/gsi/web/guides/overview and https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid (2026-10-28). Basic scopes (email, profile, openid) need no sensitive-scope review; the OAuth verification page covers anything beyond that.
- No cost statement was found in the fetched pages, so "free" is unconfirmed in writing. In practice no billing is attached to creating a client ID. ID-token verification with `jose` against Google's JWKS needs a subrequest to fetch keys; cache the keys in KV or in isolate memory.

## 5. Workers Static Assets

- Asset requests are free and unlimited; only requests that invoke the Worker are billable. Storage has no extra cost. On Free, `run_worker_first` matches always invoke the Worker, and over the free request limit they return 429. https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/ (2026-10-28).
- Limits: 20,000 files per Worker version (Free), 25 MiB per file, 100 `_headers` rules, 2,100 `_redirects` rules. https://developers.cloudflare.com/workers/platform/limits/ (2026-10-28).
- SPA mode: `not_found_handling: "single-page-application"` serves `/index.html` with 200 for unmatched paths. With compatibility date 2025-04-01 or later, browser navigations (`Sec-Fetch-Mode: navigate`) skip the Worker; `fetch()` calls still invoke it. `run_worker_first: ["/api/*"]` makes the routing explicit (Wrangler 4.20.0+). https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/ (2026-10-28).
- A Vite SPA is far below the file and size limits. Fits.

## Open items (unconfirmed)

1. Real CPU cost of ES256 verify and sign on Workers (needs a deployed test).
2. Whether user-initiated LIFF sends count against the OA quota.
3. Explicit "free" statements for LIFF and Google sign-in.
4. Behavior of requests over 100,000/day on the pricing page (limits page implies errors; not quoted).
5. Note: Taiwan LINE pricing changes on 2026-11-01 and some tw.linebiz pages still show old prices; recheck before launch.

## Recommendation

- Treat LINE push as unavailable on the free plan: 200 messages/month is below even 20 single-recipient pushes in 10 days. Build around Reply, share links and an in-app inbox.
- Do not run the exact 20-balance partition search in the Worker. It takes about 78 ms in my test against a 10 ms limit. Run it client-side in the SPA, or limit exact search to roughly 12 to 14 balances with a greedy fallback.
- Keep API traffic on Workers with `run_worker_first: ["/api/*"]`; 100,000 requests/day is about 4 times the assumed load.
- D1 and Static Assets fit with indexes and `db.batch()`.
- Before launch, deploy a test Worker that measures ES256 verify and sign CPU, and cache Google's JWKS.
