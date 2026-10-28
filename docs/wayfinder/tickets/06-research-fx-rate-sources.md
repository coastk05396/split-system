---
title: Research exchange rate sources
type: wayfinder:research
mode: AFK
status: closed
assignee:
parent: ../map.md
blocked_by: []
---

## Question

Which free or low-cost daily FX rate APIs cover TWD, USD, JPY, THB, EUR and other common travel currencies? Compare update cadence, historical-date support, licence terms and fit with a Worker (rate limits, caching).

## Resolution

Primary source: Frankfurter. It covers TWD and the other nine currencies checked, needs no API key, has no quotas, supports date lookup, and its docs say the blended rates are free for commercial use. Cache each (date, currency) result in the Cache API or KV. Fallback: ExchangeRate-API open access (covers TWD, allows commercial use and caching, requires an attribution link, forbids redistribution); fawazahmed0 (CC0, date-addressable) only as a last resort. The ECB reference rates do not cover TWD, so use them only for cross-checks. Open Exchange Rates is weak on cost and its free-plan commercial and attribution terms are unconfirmed.

Findings: branch `research/research-fx-rate-sources` on origin, file `docs/research/research-fx-rate-sources.md` (throwaway, never merged).
