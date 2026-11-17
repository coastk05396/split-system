---
status: accepted
---

# GitHub Actions Sync and Google Live Price Verification

Stage 2 re-asked Travelpayouts, the same cache that produced the candidate, so a fare sold out or repriced within the 48-hour freshness window still passed. The Worker's 1,000 subrequest ceiling also forced the Baseline candidate count down to 2 per Route. We move the daily sync to GitHub Actions and verify candidates against Google Flights. This partly supersedes ADR 0006 (no Container) and ADR 0007 (the sync no longer runs in the Worker cron; the Trip.com redirect is unchanged). It extends ADR 0010.

## Decision

1. **Actions run the sync**: a scheduled and manually dispatchable workflow runs the existing collect-and-sync script and writes D1 with one atomic SQL batch. Schedule is 07:00 Taipei (23:00 UTC) to finish before the "updated 08:00" promise.
2. **Manual runs**: the workflow has a dry-run (default) and a write mode; the local `sync-flights` script stays and gains a verification-source option.
3. **Google Flights is the Stage 2 source**: a small Python adapter (`fast-flights`) takes candidate JSON and returns a Live Price per candidate. The TypeScript pipeline stays the owner of scoring.
4. **Live Price replaces the cached price only for a matching itinerary** (same Route, dates, trip type, stop class, airline set). The Deal Signal is recomputed and the fare is dropped if it falls under 15%.
5. **No Live Price never removes a fare**: no result, an error, a different airline or a block keeps the Travelpayouts price. Google omits some low-cost carriers, so absence is not evidence of a Ghost Fare.
6. **A higher Live Price reprices, it does not drop**: the 20% and NT$800 jump rule applies only to the Travelpayouts-only verifier.
7. **Polite querying**: one query at a time with about 3 seconds between queries (Google blocked faster pacing from a home IP), a hard cap per run, and the run stops querying at the first explicit block signal (HTTP 429/403, consent or verification page, or any page without Google's results payload) and keeps cached prices for the rest. A page that fails to parse is an error, never a block. No retries, no evasion. The summary counts ok, no_result, error and blocked queries and tallies block reasons (`http`, `consent`, `sorry`, `no_payload`).
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
- **Schedule**: 23:00 UTC writes production D1 (`wrangler d1 execute DB --remote --env production`, one atomic SQL file, the same path as `sync-flights --remote`).
- **Manual run**: Actions, "Sync flights", Run workflow; `dry-run` (default) uploads `sync-flights-sql` as an artifact and writes nothing, `write` updates D1 and the run marker.
- **Local**: `pnpm --filter @split/worker sync-flights -- --verify=google --profile=actions --dry-run` needs `pip install -r apps/worker/scripts/google-live-price/requirements.txt` (`GOOGLE_LIVE_PYTHON` selects the interpreter). Without flags it still verifies with Travelpayouts and the Worker budget.
- **Failures**: a thrown error fails the run and shows in GitHub's failed-run notifications; Google problems never fail it (cached prices stay). The summary log line (`live`: repriced, kept, dropped, blocked) shows Google's hit rate.
- **Known limit**: Google is queried for the outbound leg and the round-trip total, so the return leg's stop count comes from the cached fare.
