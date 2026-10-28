---
title: Research Cloudflare hosting for the SPA and Workers
type: wayfinder:research
mode: AFK
status: closed
assignee:
parent: ../map.md
blocked_by: []
---

## Question

For serving a Vite SPA plus a Hono API on Cloudflare: is Pages still the right choice or should the SPA be Workers static assets, and what are the current free-tier limits for Workers, D1 and KV that matter at this scale? Also: what does ctx.waitUntil guarantee, and what happens to work still running when the response is sent?

## Resolution

Serve the SPA as Workers static assets with Hono in the same Worker (SPA `not_found_handling`, `run_worker_first: ["/api/*"]`); Pages only if a domain must stay on non-Cloudflare nameservers. Free-tier limits that bind first: 100k Worker requests/day and KV 1,000 writes/day, then D1 100k rows written/day; plan for Workers Paid. `waitUntil` gets at most 30 seconds after the response and is cancelled without retry, so it is best-effort only; anything critical is written to D1 before responding.

Unconfirmed in the findings: a Pages sunset date, KV delete and list limits, and `waitUntil` behaviour when the handler throws. Pages were read through a summarizing fetcher, so recheck exact figures before relying on them.

Findings: branch `research/research-cloudflare-hosting` on origin, file `docs/research/research-cloudflare-hosting.md` (throwaway, never merged).

Note added later: the "plan for Workers Paid" advice is superseded by the all-free preference; whether the free plan carries v1 is the question of **Research whether free tiers carry v1**.
