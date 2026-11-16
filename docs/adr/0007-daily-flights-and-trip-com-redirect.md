# Three-Stage Daily Cheap Flights Pipeline and Bilingual Trip.com Redirect

## Context

Interactive multi-date calendar scraping against Google Flights (`GetCalendarGraph` / `batchexecute`) is gated by BotGuard (`x-goog-batchexecute-bgr`), failing with `HTTP 400` in automated pipelines. Furthermore, forcing users to fill search forms on mobile creates unnecessary friction when most leisure travelers from Taiwan simply want to browse today's cheap fares across popular regions at a glance.

## Decision

We adopt a three-stage, zero-typing Daily Cheap Flights architecture under the **小芽** (`Sprout`) product:

1. **Stage 1 — Broad Cached Discovery (`Travelpayouts v3/prices_for_dates`)**:
   - The dedicated flight cron job (`0 0 * * *`, 08:00 Taipei time) scans all 5 Taiwan origins (`TPE`, `TSA`, `KHH`, `RMQ`, `TNN`) via `X-Access-Token` header auth once per departure month across separate round-trip (~150) and one-way (~50) quotas split over the regions (`jp`, `kr`, `sea`, `hkmo`, `longhaul`), at most 5 dates per route, for fares departing 14 days to 6 months out (limits superseded by ADR 0008) when `TRAVELPAYOUTS_TOKEN` is configured. When unconfigured or upstream returns no deals, D1 persists nothing and `GET /api/v1/flights/daily` returns built-in curated preview deals with `isFallback: true` so the UI discloses reference-only pricing.
2. **Stage 2 — Candidate Re-Validation (`AppDeps.flightSource` / `FlightSource.verifyCandidate`), Ghost-Fare Removal & Red-Eye Tagging**:
   - Each candidate runs through the pluggable `FlightSource.verifyCandidate` boundary (whose default `productionFlightSource` implementation re-queries Travelpayouts by exact `origin`, `dest`, `outDate`, and `inDate`, rejecting non-matching directness/dates and syncing verified airline/transfer fields; an omitted `found_at` is accepted because Travelpayouts `v3/prices_for_dates` omits it, while any present malformed or `> 48h` `found_at` is still dropped).
   - Any fare whose verification check returns `null` or exceeds the discovery fare by both `> 20%` and `> NT$800` is discarded as a Ghost Fare (`幽靈票`).
   - Local arrival clocks are computed in each destination/origin IATA timezone; flights with departure or arrival in `00:00–05:59` are retained and flagged (`isRedEye: true`) for a clear `🌙 紅眼` / `Red-eye` pill.
   - Surviving fares compute `DealSignal` (`"steal"` ≥ 30%, `"below_market"` ≥ 15%, or `"normal"`) against the median of the day's Stage 1 candidates for the same destination and trip type (see the addendum below) and batch-insert into D1 (`<= 5` rows per statement, max 85 bound parameters under D1's 100-parameter cap).
3. **Stage 3 — Public API & Stateless Bilingual Trip.com Affiliate Redirect (`/api/v1/flights/go`)**:
   - Both `GET /api/v1/flights/daily` and `GET /api/v1/flights/go` are public (no auth cookie/bearer required) so signed-out visitors on `/` (`LandingPage`) and `/flights` can browse and book without friction.
   - `GET /api/v1/flights/go` strictly validates `origin`, `dest`, `outDate`, `inDate`, `tripType`, and `lang` via Zod (`flightGoQuerySchema`) and returns a `302` redirect built strictly for `tw.trip.com` (`lang=zh-TW`) or `www.trip.com` (`lang=en`), preventing open redirects and appending affiliate parameters (`Allianceid`, `SID`) when configured.

## Consequences

- Avoids headless browser scraping and BotGuard bypass complexity, while clearly disclosing `isFallback: true` curated deals rather than persisting synthetic seed fares as verified market prices.
- Total flight cron subrequests are now about `70` discovery (5 origins × 2 trip types × the 6–7 calendar months of the window) + up to `200` verification ≈ `270` sequential external fetches, which needs Workers Paid (ADR 0008; the earlier 10 + 20 = 30 fetch budget fit the free plan). D1 query parameters stay `<= 85` per statement, and the cron stays isolated from the `30 16 * * *` cleanup/FX cron.
- Eliminates open-redirect risk by validating structured route parameters and constructing fixed Trip.com hosts server-side.

## Addendum (2026-11): Deal Signal scored against the day's median

Deal Signal no longer compares a fare with a hard-coded per-destination baseline (with a 0.58 factor for one-way fares). Those baselines sat well above the market, so nearly every card read "省 46–56%" and the badge could not tell a good deal from an ordinary one. The baseline is now the **median of that run's Stage 1 candidate prices for the same destination and trip type**, taken over the whole discovery pool before quota selection. A destination and trip type with fewer than **3** candidates has no baseline and yields no signal (`normal`, 0%). Tiers are unchanged: `steal` ≥ 30%, `below_market` ≥ 15%, `normal`.

This is hard to reverse because stored `discount_pct` and `tag` values, and the meaning users give the badge, now describe "cheaper than this destination usually is today" rather than "cheaper than a fixed reference". The per-destination `baselineTwd` and `ONE_WAY_BASELINE_FACTOR` remain only to score the curated fallback board (`isFallback: true`), which has no candidate pool.
