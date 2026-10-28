---
title: Research whether free tiers carry v1
type: wayfinder:research
mode: AFK
status: closed
assignee:
parent: ../map.md
blocked_by: []
---

## Question

Does the free tier alone carry v1? Using primary sources only, establish for each service the current free limits and what breaks first at a small scale (assume 500 users, 100 Groups, about 50 Expenses a day, 20 LINE notifications a day): (1) Cloudflare Workers free plan: requests per day, CPU time per request (is it 10 ms?) and whether an exact zero-sum-partition search over up to 20 balances, ES256 token verification and JWT signing fit inside it; subrequest limits; (2) D1 free plan: rows read and written per day, storage, and whether a lazy FX rate write and a batch Expense write fit; (3) LINE Official Account free plan in Taiwan: monthly message quota, whether reply messages and push messages count differently, and what a Flex notification to a group chat costs against the quota; also LIFF and Messaging API fees; (4) Google sign-in (Identity Services) cost; (5) any Cloudflare Pages or Workers Static Assets limits that apply. Finish with a verdict per service (fits, fits with a change, does not fit) and the cheapest change for each that does not fit.

## Resolution

Assumed load: 500 users, 100 Groups, about 50 Expenses a day, 20 LINE notifications a day (sources read 2026-10-28).

- **Workers requests and subrequests:** fits (100,000 requests a day and 50 subrequests per request, against about 25,000 requests a day).
- **Workers CPU (10 ms free limit):** the exact 20-balance partition search does **not** fit; it measured about 78 ms in Node. Either run the search in the browser, or cap the exact search at 12 to 14 balances with the greedy fallback. ES256 verify and JWT signing probably fit but were not measured.
- **D1:** fits, at roughly 900 rows written a day against 100,000. Add indexes and write with `db.batch()`.
- **LINE Official Account (Taiwan):** push does **not** fit. The free plan is 200 messages a month and a push to a group counts once per member. Reply messages are free. Use replies and user-initiated share links, not push notifications. Taiwan plans change on 2026-11-01 but the free plan does not.
- **Google sign-in:** fits, but no explicit pricing statement was found, so "free" is unconfirmed.
- **Static Assets:** fits; use `run_worker_first: ["/api/*"]` so SPA navigations skip the Worker.

Effects on open tickets: **Decide the settlement flow** must place the exact search (browser, or a smaller cap); **Decide LINE Bot scope** must drop group push notifications; the earlier hosting advice to plan for Workers Paid no longer applies.

Findings: branch `research/research-free-tier-fit` on origin, file `docs/research/research-free-tier-fit.md` (throwaway, never merged; the agent could not run git, so the commit was made by hand and is unsigned).
