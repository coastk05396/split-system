---
status: accepted
---

# SerpApi Explore Sync in the Worker and Google Typical-High Baselines

The Daily Flights board came from a 48-hour Travelpayouts cache with thin Taiwan coverage and stale phantom fares, then up to 240 sequential Google Flights scrapes from GitHub Actions datacenter IPs. When Google throttled or blocked those requests the board silently kept the cached prices, which drifted far from Trip.com, and a Python runtime, a second workflow and a two-stage verifier made the pipeline fragile for a zero-budget product. We replace all of it with one pure-TypeScript sync in the Worker cron on SerpApi's free tier. This supersedes ADR 0006 (Google queries in a Container), ADR 0008 (Workers Paid for a larger verified board), ADR 0010 (deal-first board) and ADR 0012 (GitHub Actions sync and Google Live Price). The Trip.com redirect of ADR 0007 is unchanged.

> Amended by ADR 0014: decision 2 (the query plan), decision 4 (keys: three role keys replace `SERPAPI_KEYS`), decision 5 (a `TSA` fare is admitted only as a real deal) and decision 7 (Baseline refresh on its own key; no static Baseline tier for the board).

## Decision

1. **One stage, in the Worker cron** (`0 0 * * *`, 08:00 Taipei): plain `fetch` calls to SerpApi, no Python, no GitHub Actions workflow, no Travelpayouts, no verification stage. The Worker cron runs on every trigger; there is no skip window. A local CLI (`sync-flights`) keeps manual dry runs and backfills.
2. **8 `google_travel_explore` queries a day**, one after another, all `currency=TWD`, `hl=en`, `gl=tw`, round trip: `TPE` Asia (the default viewport, which also reaches the Middle East hubs), `TPE` Europe (`/m/02j9z`), `TPE` North America (`/m/059g4`), `TPE` Oceania (`/m/05nrg`), `KHH` Asia, `TSA` Asia, plus `TPE` Asia scoped to 2 rotating calendar months inside Explore's open 6-month window (the next 5 months, 2 a day) for more departure dates on popular short-haul routes. 8 calls a day is about 248 a month, inside one free key.
3. **No carry-over**: a run that gets any answer from SerpApi replaces the whole board and its completion marker in one atomic D1 batch, even with zero admissible fares. A run that gets no answer (no key, every key spent, upstream down) writes nothing: the previous board stays until it is 48 hours old, then the curated fallback is served.
4. **Keys**: `SERPAPI_KEYS` is a comma-separated list. A key answering 401, 403, 429 or an out-of-searches/invalid-key error is skipped for the rest of the run and the same query is retried on the next key. Keys never appear in logs.
5. **Admission (a Low-Fare Overview)**: a fare is admitted when its destination is a Curated Destination, it is a round trip returning after it departs, it departs from tomorrow through 6 months from the run date (inclusive) and it has fewer than 3 stops; the cheapest fare per origin x destination x departure date is kept. There is no discount floor: the board is never empty only because nothing is cheap that day. The discount decorates a fare, it does not gate it.
6. **Airlines**: a single IATA `airline_code` is stored as `[code]`. `"multi"` with a combined `airline` string is split into carriers, known names mapped to IATA codes, unknown names kept verbatim, repeats dropped, order kept. The UI joins them with ` + `, and an airline filter matches any carrier of the fare.
7. **Baseline**: Google Flights `price_insights.typical_price_range` per origin and destination, cached in D1 for 30 days (`typicalLowTwd`, `typicalHighTwd`, `fetchedAt`), seeded and refreshed by a CLI and opportunistically for missing or expired Routes when quota allows. A fare's Baseline resolves `(origin, destination)`, then `(TPE, destination)`, then the Curated Destination's static baseline.
8. **Deal Signal** is the rounded percentage below `typicalHighTwd`, never below 0: `steal` from 50% (solid green pill with a flame), `below_market` 15-49% (plain green text), nothing under 15%. The expanded City Card says the discount compares against the Route's typical high price and checkout prices follow the booking page.
9. **Contraction**: origins are `TPE`, `KHH`, `TSA` (`RMQ` and `TNN` leave discovery and the filter), one-way fares and the one-way baseline factor go, and `isRedEye`, `outboundDep`, `inboundDep` and `returnTransfers` leave the schema and API because Explore does not supply them. `Live Price`, `Unverifiable Airline`, `Ghost Fare` and `Good Deal` leave the glossary.

## Consequences

- Board prices are Google's current Explore prices, so they track what Trip.com shows closely, and low-cost carriers appear without a blocklist.
- Coverage is what Explore returns for each query (one fare per destination city and query), not every Route and date; the extra month queries add dates for `TPE` Asia only.
- The free tier is the only budget: a second key (`SERPAPI_KEYS=a,b`) buys Baseline refreshes and more month scans; production keys live only in Cloudflare Worker secrets and the key used while exploring is rotated after the first deploy.
- Skyscanner's Partner API was considered; its referral-link exclusivity conflicts with redirecting to Trip.com, so it is out of scope.
