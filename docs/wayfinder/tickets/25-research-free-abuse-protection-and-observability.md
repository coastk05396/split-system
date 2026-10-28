---
title: Research free abuse protection and observability
type: wayfinder:research
mode: AFK
status: closed
assignee:
parent: ../map.md
blocked_by: []
---

## Question

All-free constraint, primary sources only. (1) What abuse protection exists on the Cloudflare free plan for a Worker API: WAF rate limiting rules (how many, what they can count by, limits on period and action), Turnstile on the login and join screens, and whether Workers can do their own per-IP or per-User counting cheaply without KV write limits; (2) what observability is free for Workers and D1: Workers Logs and Traces (retention, event limits), `wrangler tail`, D1 metrics, and any free alerting or notification option for errors and for approaching the free request and row limits; (3) the rate limits the LINE Messaging API, LINE Login and Google token verification impose that our Worker must respect. Finish with a verdict per item (fits, fits with a change, does not fit) and the cheapest free setup.

## Resolution

- **WAF rate limiting: fits with a change.** The free plan gets 1 rule, counted by IP only, with a 10 s period and a 10 s block, and it can match on path. Use that one rule on `/api/v1/auth/*`. Whether it covers Worker traffic on the custom domain is unconfirmed.
- **Turnstile: fits.** 20 widgets and unlimited verifications.
- **Counting requests in the Worker: fits with a change.** Use D1 only on auth and write endpoints, at about 1 to 2 rows written per check, and never KV.
- **Logs, `wrangler tail`, metrics: fits.** Workers Logs allows 200,000 events a day with 3-day retention; from 2026-12-01 that becomes 0.5 GB a day with 7-day retention.
- **Alerts for errors or for nearing the free limits: does not fit.** The notifications page lists no free alert for either.
- **LINE and Google rate limits: fits.** LINE reply allows 2,000 requests per second; LINE Login verify limits are undisclosed; verify Google ID tokens locally with Google's public keys.
- **Unconfirmed:** whether the free plan can use the Workers rate-limit binding, and whether free-plan Traces are available.

Findings: branch `research/free-abuse-protection-and-observability` on origin, file `docs/research/research-free-abuse-protection-and-observability.md` (throwaway, never merged; the agent could not run git, so the commit was made by hand and is unsigned).
