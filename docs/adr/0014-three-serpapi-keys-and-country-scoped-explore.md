---
status: accepted
---

# Three SerpApi Keys by Role and Country-Scoped Explore Queries

The board under-covered Japan, Korea and the long-haul areas, and showed expensive Songshan (`TSA`) fares. Probing SerpApi showed why: the Asia Explore query returns about 110 destinations (about 60 usable) and one fare per destination, so Korea surfaced only Seoul and Japan only 8 cities; Europe, North America and Oceania returned 36, 35 and 52 usable cities but the Curated Destination catalog kept only 10, 10 and 5. This amends ADR 0013 (decisions 2, 4, 5 and 7) and the Middle East scope of ADR 0011.

## Decision

1. **Three role keys, no pooling**: `SERPAPI_KEY_BASELINE`, `SERPAPI_KEY_SHORT` and `SERPAPI_KEY_LONG` replace `SERPAPI_KEYS`. A role uses only its own key; a refused or missing key skips that role for the run, with a log line and no key. Pooling is rejected because a long-haul expansion would drain Baselines. The cost is stranded quota on a key that is not fully used.
2. **Short-haul, 8 queries a day**: `TPE`, `KHH` and `TSA` Asia; `TPE` Japan and `KHH` Japan; `KHH` Korea; one `TPE` Japan query and one `TPE` Korea query scoped to a month. Country scope uses `arrival_area_id` with the country's Knowledge Graph id (Japan `/m/03_3d`, South Korea `/m/06qd3`). `TPE` Korea returns nothing without `month`, so it is always month-scoped.
3. **Long-haul, 6 queries a day**: `TPE` Europe, North America, Oceania and Middle East (`/m/04wsz`, which includes Turkey), plus one month-scoped query each for Europe and North America. Every query runs every day: the board is replaced whole (ADR 0013, decision 3), so a rotated query's fares would vanish on the days it does not run.
4. **Month choice**: for Japan, Europe and North America the month is the cheapest one in the same day's unscoped answer; for `TPE` Korea it is the cheapest one in the `KHH` Korea answer, falling back to a rotating upcoming month. The current month is never chosen.
5. **Baseline**: the Baseline key spends at most 8 `google_flights` requests a day on board Routes that have no fresh Baseline or an expired one, missing first. A Route's Baseline lasts 30 days, so about 160 Routes cost about 160 requests a month. A fare with no Baseline has no Deal Signal; the static `baselineTwd` stays only for the curated fallback board and becomes optional.
6. **Songshan admission**: a `TSA` fare is shown only when it is at least 15% below its Baseline. `TSA` is never cheaper than `TPE` and only three destinations are nonstop, so a whitelist would still show full-service fares at 2-3 times the `TPE` price. `KHH` is unchanged.
7. **Catalog and areas**: about 46 more Curated Destinations (Europe, North America, Oceania, Middle East) with `baselineTwd` optional. `中東` becomes Turkey, the Emirates, Qatar, Egypt and Jordan.

## Consequences

- A city has at least 1 fare; long-haul cities usually 1-2, Korea's Busan 2 (`TPE` and `KHH`), Southeast Asia 4-5.
- A run where one role's key is refused still replaces the whole board, so that role's fares disappear that day; the long-haul key runs near 180 of its 250 monthly searches to leave room.
- Quota assumes 250 searches a month per free key (ADR 0013).
- Southeast Asia has no country queries: the Asia query already returns about 15 of its airports.
