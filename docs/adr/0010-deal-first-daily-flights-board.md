---
status: accepted
---

# Deal-first Daily Flights Board

The board used to pick the cheapest fares per Flight Region and only then score them, so ordinary-priced fares filled it and many countries showed nothing good. Rival boards instead keep only fares well below the Route's usual price. We now rank and admit fares by how far they sit below their Baseline, so every fare on the board is a Good Deal. This refines ADR 0009.

## Decision

1. **Rank by discount, then price**: a fare's discount against its Baseline decides which fares are kept; price only breaks ties.
2. **Admit Good Deals only, never pad**: a fare needs a Deal Signal of 15% or more. The 230-fare size is a ceiling, not a target. A country or city with no Good Deal that day shows nothing, and a fare without any Baseline is not shown.
3. **Baselines are per stop class**: direct fares are compared with direct, connecting with connecting, for the same Route and departure month.
4. **No fare with 3 or more stops on either leg**.
5. **Baselines before selection**: fetch Baselines for the cheapest ~6 candidates of each Route, then keep the 3 best by discount. If the daily upstream calls would pass ~800, shrink the candidate count.
6. **Per-route discovery so every country has a chance**: query the ~20 most popular destinations from each main origin, plus the main airport of every other country from the main Taipei airport, next to the existing broad discovery.
7. **City card headline**: sorted by best deal, a City Card leads with its highest-discount fare; sorted by lowest price it is unchanged.
8. **No carry-over**: when no verified fare exists today, yesterday's fare is not reused.

## Considered Options

- **Pad the board with the cheapest ordinary fares**: Rejected because the goal is Good Deals; a fare near its Baseline is not one.
- **Guarantee one fare per country**: Rejected because it would force non-deals onto the board.
- **An absolute "steal" price threshold per region**: Not needed; each Route is judged against its own Baseline.
- **Reuse yesterday's best fare when today has none**: Rejected because the price may have expired, which is what Ghost Fare verification exists to prevent.

## Consequences

- The board can hold fewer than 230 fares, and some countries will be empty on some days.
- More upstream calls per run; the real count is measured when discovery ships.
- The cached Baseline gains a stop class, so its table changes shape (the cache is disposable and rebuilds within 3 days).
- ADR 0009 decision 3 (230-fare target) is now a ceiling, and its call estimate in decision 4 no longer holds.
