# Two-Stage Daily Cheap Flights Pipeline and Bilingual Trip.com Redirect

## Context

Interactive multi-date calendar scraping against Google Flights (`GetCalendarGraph` / `batchexecute`) is gated by BotGuard (`x-goog-batchexecute-bgr`), failing with `HTTP 400` in automated pipelines. Furthermore, forcing users to fill search forms on mobile creates unnecessary friction when most leisure travelers from Taiwan simply want to browse today's verified cheap fares across popular regions at a glance.

## Decision

We adopt a three-stage, zero-typing Daily Cheap Flights architecture under the **小芽** (`Sprout`) product:

1. **Stage 1 — Broad Cached Discovery (`Travelpayouts v3/prices_for_dates`)**:
   - The daily cron job (`dailyMaintenance`) fetches cheap Taiwan-outbound candidates from Travelpayouts across balanced regional quotas (`jp`, `kr`, `sea`, `hkmo`, `longhaul`) when `TRAVELPAYOUTS_TOKEN` is configured, or falls back cleanly to a curated verified dataset when unconfigured in local development.
2. **Stage 2 — Live Verification, Ghost-Fare Removal & Red-Eye Tagging**:
   - Candidate itineraries are checked against a live flight verifier (`AppDeps.flightSource` / `FlightSource.verifyCandidate`) before persistence to D1 (`daily_flights`).
   - Any fare whose live check returns no match (`null`) or exceeds the cached fare by both `> 20%` and `> NT$800` is discarded as a Ghost Fare (`幽靈票`).
   - Red-eye flights (`00:00–05:59` departure or arrival) are retained and flagged (`isRedEye: true`) so they render a clear `🌙 紅眼` / `Red-eye` pill in the UI.
   - Each surviving fare computes a `DealSignal`: `"steal"` (`🔥 神價`, discount ≥ 30%), `"below_market"` (`低於行情`, discount ≥ 15%), or `"normal"`.
3. **Stage 3 — Public API & Stateless Bilingual Trip.com Affiliate Redirect (`/api/v1/flights/go`)**:
   - Both `GET /api/v1/flights/daily` and `GET /api/v1/flights/go` are public (no auth cookie/bearer required) so signed-out visitors on `/` (`LandingPage`) and `/flights` can browse and book without friction.
   - `GET /api/v1/flights/go` strictly validates `origin`, `dest`, `outDate`, `inDate`, `tripType`, and `lang` via Zod (`flightGoQuerySchema`) and returns a `302` redirect built strictly for `tw.trip.com` (`lang=zh-TW`) or `www.trip.com` (`lang=en`), preventing open redirects and appending affiliate parameters (`Allianceid`, `SID`) when configured.

## Consequences

- Avoids headless browser scraping and BotGuard bypass complexity.
- Prevents stale/ghost cached prices from frustrating travelers on click-through.
- Eliminates open-redirect risk by validating structured route parameters and constructing fixed Trip.com hosts server-side.
