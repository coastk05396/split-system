---
status: accepted
---

# Nonstop Fares, a Second Long-Haul Key and Fare Depth per City

ADR 0014 left long-haul cities with 1-2 fares, never showed a nonstop fare when a connection was cheaper (Seattle nonstop NT$22,654 hidden behind NT$21,924 with a stop), and moved the two rotating `TPE` Asia month queries to Japan and Korea, which drops Southeast Asia and China/HK/Macau from 4-5 fares a city to 2-3; its "Southeast Asia 4-5" consequence was a miscount. Probing on 2026-11-25 also showed: Songshan (`TSA`) fares were dearer than `TPE` for all 21 board cities (median +NT$19,030); a Canada-scoped query prices Montreal, which the North America query never does; and the cheapest-month rule picks the month most cities already sit in (North America: 27 of 35 in December), so its fares mostly repeat. This amends ADR 0014 decisions 2, 3, 4 and 6.

## Decision

1. **Max 2 stops in the query**: every Explore query without a month sends `stops=3`, so Google picks the cheapest fare of at most 2 stops instead of one the board then drops. A month-scoped query sends no `stops`: Explore answers `stops` together with `month` with empty results (probed 2026-11-26), so those fares rely on admission's 3-stop guard.
2. **No Songshan**: the `TSA` Asia query and the `TSA` admission gate go. Its short-haul slot runs a second month-scoped `TPE` Asia query.
3. **Short-haul, 8 queries a day**: `TPE` and `KHH` Asia; `TPE` Asia scoped to two months; `TPE` Japan and `KHH` Japan; `KHH` Korea; `TPE` Korea scoped to a month. The `TPE` Japan month query goes: Japan's large cities are in the Asia queries, and its smaller cities keep 2 fares (`TPE` and `KHH` Japan).
4. **Long-haul, 8 queries a day** on `SERPAPI_KEY_LONG`: `TPE` Europe, North America, Oceania, Middle East and Canada (`/m/0d060g`); one month-scoped query each for Europe, North America and Oceania.
5. **A second long-haul key** (the fourth key, 8 queries a day, its variable named in `docs/RELEASE.md`): nonstop-only (`stops=1`) `TPE` North America, Europe and Oceania; a second month-scoped query for Europe, North America and Oceania; two for the Middle East. Each long-haul city is reached by at least 3 queries. Short-haul nonstop queries are rejected: its cheapest fares are mostly nonstop already (Japan 61%, Korea 100%).
6. **Month choice**: a month-scoped query takes the upcoming month, within Explore's 6-month window and never the current month, with the fewest cities in its unscoped answer (`TPE` Korea reads the `KHH` Korea answer); a second one takes the next fewest. Ties go to the earlier month. This replaces the cheapest-month rule, whose answer repeats the unscoped one.
7. **Nonstop Fare admission**: a fare from a nonstop-only query is kept only when it costs at most 20% more than its city's cheapest fare that day, and it is never merged with a connecting fare on the same date. Its Deal Signal uses the same Baseline and formula as any fare: no separate nonstop Baseline.

## Consequences

- Fares a city can reach: Southeast Asia, China/HK/Macau, Japan's large cities and Seoul 4 or more; Canada 4; the US, Europe, Oceania and the Middle East 3; Japan's smaller cities and Busan, Jeju and Daegu 2. These are upper bounds: Google leaves some cities unpriced, and two queries on the same date merge.
- Every key spends 8 queries a day, 248 in a 31-day month, against 250 free searches: one extra run (a manual rerun) leaves the month's last run without that key, and its role's fares disappear that day.
- Four free accounts on one owner may break SerpApi's terms; unchecked.
- `TPE` Korea is still month-scoped. ADR 0014 said it returns nothing without a month; on 2026-11-25 it priced 4 cities without one. Not changed here.
