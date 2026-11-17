---
status: accepted
---

# GitHub Actions Sync and Google Live Price Verification

Stage 2 re-asked Travelpayouts, the same cache that produced the candidate, so a fare sold out or repriced within the 48-hour freshness window still passed. The Worker's 1,000 subrequest ceiling also forced the Baseline candidate count down to 2 per Route. We move the daily sync to GitHub Actions and verify candidates against Google Flights. This partly supersedes ADR 0006 (no Container) and ADR 0007 (the sync no longer runs in the Worker cron; the Trip.com redirect is unchanged). It extends ADR 0010.

## Decision

1. **Actions run the sync**: a scheduled and manually dispatchable workflow runs the existing collect-and-sync script and writes D1 with one atomic SQL batch. Schedule is 06:00 Taipei (22:00 UTC) to finish before the "updated 08:00" promise.
2. **Manual runs**: the workflow has a dry-run (default) and a write mode; the local `sync-flights` script stays and gains a verification-source option.
3. **Google Flights is the Stage 2 source**: a small Python adapter (`fast-flights`) takes candidate JSON and returns a Live Price per candidate. The TypeScript pipeline stays the owner of scoring.
4. **Live Price replaces the cached price only for a matching itinerary** (same Route, dates, trip type, stop class, airline set). The Deal Signal is recomputed and the fare is dropped if it falls under 15%.
5. **No Live Price never removes a fare**: no result, an error, a different airline or a block keeps the Travelpayouts price. Google omits some low-cost carriers, so absence is not evidence of a Ghost Fare.
6. **A higher Live Price reprices, it does not drop**: the 20% and NT$800 jump rule applies only to the Travelpayouts-only verifier.
7. **Polite querying**: one query at a time with about 3 seconds between queries (Google blocked faster pacing from a home IP) and a hard cap per run. The run stops querying at the first explicit block signal (HTTP 429/403, a consent page, a verification page or "unusual traffic") and keeps cached prices for the rest. A page without Google's results payload (Google's soft "Verifying..." interstitial, HTTP 200) or a confirmed 5xx is transient: the adapter waits 10 seconds and re-requests the same query once (when the caller allows it: at most 20 retries per run), with no challenge solving, headers, cookies or proxies. If it is still payload-less the fare keeps its cached price and the run continues, but three such fares in a row stop it (any page with a payload resets the count). A page that fails to parse or a confirmed HTTP 5xx is an error and never counts toward stopping. A block signal is never retried, and neither is a parse failure or an exception; there is no evasion. The summary counts ok, no_result, error and blocked queries and tallies stop reasons (`http`, `consent`, `sorry`, `no_payload`) and error reasons (`server_error`, `no_payload`, `parse`, `exception:<Type>`), counts only. The summary also counts retried queries.
8. **Budget**: the Actions run may use up to 1,500 Travelpayouts calls and 6 Baseline candidates per Route. The Worker cron keeps 800 and the reduced candidate count.
9. **Worker cron becomes a fallback**: it skips when the run marker shows a completed sync in roughly the last 20 hours, otherwise it syncs as before with Travelpayouts verification.
10. **Credentials**: a Cloudflare API token limited to D1 edit, the account id and the Travelpayouts token live only in GitHub Secrets.

## Considered Options

- **Hand-written TypeScript Google parser**: Rejected; it would be a scraper we must repair whenever Google changes its page, while `fast-flights` already is that.
- **Google verification inside a Cloudflare Container (ADR 0006)**: Rejected for now; Actions already run Python at no extra cost.
- **Drop a fare when Google finds nothing**: Rejected; low-cost carrier promotions seen on Japan routes were 3 to 4 times higher on Google.
- **Scrape Trip.com for the Live Price**: Rejected; no public price API and it requires bypassing bot protection.
- **Disable the Worker cron outright**: Rejected; one failed Actions run would leave the board stale for a day.

## Consequences

- Google can throttle or change without notice; the pipeline degrades to cached prices, never to an empty board.
- Live Price is still not the Trip.com checkout price, so the board says prices follow the booking page.
- Run duration grows to a few minutes; the exact figure is measured on the first dry run.

## Setup

The workflow is `.github/workflows/sync-flights.yml` and uses the `production` GitHub environment, as the deploy workflow does.

- **Secrets** (repository or `production` environment): `TRAVELPAYOUTS_TOKEN`, `CLOUDFLARE_API_TOKEN` (D1 edit only), `CLOUDFLARE_ACCOUNT_ID`. They are passed only as step `env`, never echoed or written to files. Rotate the Travelpayouts token before first use.
- **Schedule**: 22:00 UTC writes production D1 (`wrangler d1 execute DB --remote --env production`, one atomic SQL file, the same path as `sync-flights --remote`).
- **Manual run**: Actions, "Sync flights", Run workflow; `dry-run` (default) uploads `sync-flights-sql` as an artifact and writes nothing, `write` updates D1 and the run marker.
- **Local**: `pnpm --filter @split/worker sync-flights -- --verify=google --profile=actions --dry-run` needs `pip install -r apps/worker/scripts/google-live-price/requirements.txt` (`GOOGLE_LIVE_PYTHON` selects the interpreter). Without flags it still verifies with Travelpayouts and the Worker budget.
- **Run time**: the Google cap is 240 queries (the 1,500 is the Travelpayouts ceiling). Retries are budgeted run-wide: at most `MAX_RETRIES_PER_RUN` = 20, so Google requests never exceed 240 + 20 = 260 (a test asserts it); once the budget is spent a failing page is simply not retried. A confirmed 5xx counts toward the 3-in-a-row stop the same as a payload-less page, so a dead Google costs 3 queries plus 3 retries. At 3 s between queries plus about 2 s per fetch the cap is about 20 minutes (about 10 for the usual ~120), and retries add at most 20 x ~12 s = 4 minutes. With roughly 8 minutes of Travelpayouts calls the usual run is about 20 minutes and the worst case about 33 (240 x 5 s + 4 + 8 = 32), inside the 40-minute timeout.
- **Failures**: a thrown error fails the run and shows in GitHub's failed-run notifications; Google problems never fail it (cached prices stay). The summary log line (`live`: repriced, kept, dropped, blocked) shows Google's hit rate.
- **Result groups**: Google splits results into best flights (where most low-cost carriers sit) and other flights; fast-flights 3.1.0 reads only the latter, so the adapter parses both groups itself, skips malformed or price-less itineraries and sorts the rest cheapest first. A missing or empty group is no result, not an error.
- **Known limit**: Google is queried for the outbound leg and the round-trip total, so the return leg's stop count comes from the cached fare.
- **Overlap with the Worker fallback**: the job timeout is 40 minutes (estimated run 20 to 25) so a run that starts at 22:00 UTC ends well before the Worker cron at 00:00 UTC, which only reads the completed-run marker and would otherwise start a competing D1 write. GitHub can delay scheduled starts; the job still finishes before 00:00 UTC if it starts by 23:20 UTC, so a delay of up to about 80 minutes is tolerated. A longer delay could overlap and the Worker would then also sync (the last atomic write wins, both boards are valid). We accept this rather than add a lock.
