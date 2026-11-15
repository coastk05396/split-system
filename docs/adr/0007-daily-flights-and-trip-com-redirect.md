# Three-Stage Daily Cheap Flights Pipeline and Bilingual Trip.com Redirect

## Context

Interactive multi-date calendar scraping against Google Flights (`GetCalendarGraph` / `batchexecute`) is gated by BotGuard (`x-goog-batchexecute-bgr`), failing with `HTTP 400` in automated pipelines. Furthermore, forcing users to fill search forms on mobile creates unnecessary friction when most leisure travelers from Taiwan simply want to browse today's cheap fares across popular regions at a glance.

## Decision

We adopt a three-stage, zero-typing Daily Cheap Flights architecture under the **小芽** (`Sprout`) product:

1. **Stage 1 — Broad Cached Discovery (`Travelpayouts v3/prices_for_dates`)**:
   - The daily cron job (`dailyMaintenance`) scans all 5 Taiwan origins (`TPE`, `TSA`, `KHH`, `RMQ`, `TNN`) via `X-Access-Token` header auth across balanced regional quotas (`jp`, `kr`, `sea`, `hkmo`, `longhaul`, max 30 candidates) when `TRAVELPAYOUTS_TOKEN` is configured. When unconfigured or upstream returns no deals, D1 persists nothing and `GET /api/v1/flights/daily` returns built-in curated preview deals with `isFallback: true` so the UI discloses reference-only pricing.
2. **Stage 2 — Candidate Re-Validation (`AppDeps.flightSource` / `FlightSource.verifyCandidate`), Ghost-Fare Removal & Red-Eye Tagging**:
   - Each candidate runs through the pluggable `FlightSource.verifyCandidate` boundary (whose default `productionFlightSource` implementation re-queries Travelpayouts by exact `origin`, `dest`, `outDate`, and `inDate`, rejecting non-matching directness/dates or `found_at` older than 48h and syncing verified airline/transfer fields, and which can be backed by a live booking verifier without changing pipeline callers).
   - Any fare whose verification check returns `null` or exceeds the discovery fare by both `> 20%` and `> NT$800` is discarded as a Ghost Fare (`幽靈票`).
   - Local arrival clocks are computed in each destination/origin IATA timezone; flights with departure or arrival in `00:00–05:59` are retained and flagged (`isRedEye: true`) for a clear `🌙 紅眼` / `Red-eye` pill.
   - Surviving fares compute `DealSignal` (`"steal"` ≥ 30%, `"below_market"` ≥ 15%, or `"normal"`) and batch-insert into D1 (`<= 5` rows per statement, max 85 bound parameters under D1's 100-parameter cap).
3. **Stage 3 — Public API & Stateless Bilingual Trip.com Affiliate Redirect (`/api/v1/flights/go`)**:
   - Both `GET /api/v1/flights/daily` and `GET /api/v1/flights/go` are public (no auth cookie/bearer required) so signed-out visitors on `/` (`LandingPage`) and `/flights` can browse and book without friction.
   - `GET /api/v1/flights/go` strictly validates `origin`, `dest`, `outDate`, `inDate`, `tripType`, and `lang` via Zod (`flightGoQuerySchema`) and returns a `302` redirect built strictly for `tw.trip.com` (`lang=zh-TW`) or `www.trip.com` (`lang=en`), preventing open redirects and appending affiliate parameters (`Allianceid`, `SID`) when configured.

## Consequences

- Avoids headless browser scraping and BotGuard bypass complexity, while clearly disclosing `isFallback: true` curated deals rather than persisting synthetic seed fares as verified market prices.
- Keeps total cron subrequests (`10` discovery + up to `30` verification = `40`) and D1 query parameters (`<= 85` per statement) within Cloudflare Workers / D1 free limits.
- Eliminates open-redirect risk by validating structured route parameters and constructing fixed Trip.com hosts server-side.
