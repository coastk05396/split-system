---
status: accepted
---

# Curated Destination Expansion and Targeted Long-Haul Discovery

## Context

`Daily Flights` previously carried 43 curated airports (`DESTINATION_CATALOG`) and 200 fares (`rt: 150, ow: 50`, up to 5 dates per route), with Stage 1 discovery querying `Travelpayouts v3/prices_for_dates` by origin and month (`limit=100`, `sorting=price`). Because cheap short-haul fares in East and Southeast Asia fill the top 100 results per origin/month, long-haul destinations (Europe, Oceania, North America, Middle East) were crowded out even if added to the catalog, and `longhaul` held only 15% of board slots.

## Decision

1. **Curated ~85-airport catalog instead of open-world airports**: Expand `DESTINATION_CATALOG` to roughly 80–90 curated travel airports (adding Europe, Oceania, North America, Middle East/South Asia/Islands, and major Mainland China cities under `港澳中`), keeping localized Chinese/English names, flags, and accurate IANA timezones for red-eye detection while filtering out unlisted minor airports.
2. **Targeted `TPE` long-haul Stage 1 supplement**: Alongside the existing 5-origin × 2-trip-type × month broad discovery (`~60–70` calls), run targeted destination queries from `TPE` for curated long-haul airports so long-haul fares are not crowded out by short-haul `limit=100` sorting.
3. **Spread the 230-fare board across more countries**: Raise the board quota to `230` fares (`rt: 200, ow: 30`), lower `MAX_DATES_PER_ROUTE` from `5` to `2–3` so a single destination does not dominate with near-identical dates, and increase the long-haul quota share to ~35%.
4. **3-day D1 cache for `month-matrix` baselines**: Cache `(origin, dest, tripType, month)` median baselines in D1 for 3 days to keep total external subrequests per cron comfortably under Cloudflare Workers Paid's 1,000-subrequest limit (`~500` calls instead of `~700+`).
5. **UI hierarchy**: Keep the existing 5 top-level `Flight Region` tabs (`日本`, `韓國`, `東南亞`, `港澳中`, `長程`) so the top bar stays uncluttered on mobile, and place sub-region (Europe, North America, Oceania, Middle East & Islands) and country filters inside the filter drawer; defer per-city SEO pages (`/flights/:city`).

## Considered Options

- **Open-world airport ingestion**: Rejected because uncurated airports lack reliable Traditional Chinese city names and timezones, inflate the shared client bundle, and often have fewer than `3` candidates for `Deal Signal`.
- **Scaling board to 500–1,000+ fares**: Rejected for now because it would require splitting the daily sync across multiple cron batches/queues to stay under Workers Paid subrequest and CPU limits.
- **Adding 8+ top-level region tabs**: Rejected because horizontal tab overflow degrades mobile header ergonomics when a filter drawer already exists.

## Amendments (2026-11-17)

- One-way quota is 5 of 230 (round trip 225), not 30 of 230: one-way fares are a secondary slice; the One-way view shows an empty state when a region has none.
- `MAX_DATES_PER_ROUTE` is fixed at 3 (the ADR allowed 2–3).
- Refined by ADR 0010: the 230-fare size is a ceiling and selection is deal-first, so decisions 3 and 4 above no longer describe the board.
