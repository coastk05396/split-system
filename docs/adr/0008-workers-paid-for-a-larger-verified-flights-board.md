---
status: accepted
---

# Workers Paid for a larger, fully verified Daily Flights board

The free plan's 50-subrequest cap per invocation held Daily Flights to 20 fares, and because one-way fares (roughly half the price of round trips) competed for the same slots, 18 of 20 ended up one-way. We decided to pay $5/month for Cloudflare Workers Paid rather than drop Stage 2 verification to fit under the cap: a board of about 200 fares (separate round-trip and one-way quotas, up to 5 dates per route) departing 14 days to 6 months out, discovered month by month and each re-verified, costs about 260 sequential Travelpayouts requests per run. That is far below Travelpayouts' 600/minute limit and Paid's per-invocation cap. Showing no Ghost Fares mattered more than staying free.

## Considered Options

- **Stay free and drop Stage 2** (one discovery call can return many fares): rejected because Stage 2 is the Ghost Fare guarantee from ADR 0007.
- **Stay free with about 35 fares**: rejected as too small next to comparable boards (around 230 fares).

## Consequences

- Workers Paid must be active for as long as this runs (it is active as of acceptance). On the free plan the cron would exceed 50 subrequests partway through and fail.
- Fares departing within 14 days or more than 6 months out are never shown. Travelpayouts has little cached data beyond 6 months, and short-notice trips are rarely bookable.
- Updates the limits stated in ADR 0007 (20 fares, 30 subrequests).
