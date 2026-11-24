---
status: accepted
---

# Destination Areas in the Filter, No Region Tabs

The board had five top-level region tabs, with long-haul sub-regions and a country filter hidden behind the Long-haul tab. A rival board shows one row of destination areas with fare counts inside its filter, and nothing above the list. We now follow that: the tabs and the sort buttons are removed and the filter's destination block is one row of Flight Regions. This supersedes decision 5 of ADR 0009.

> Amended by ADR 0014: decision 4 (`中東` grows from Turkey and the Emirates to Turkey, the Emirates, Qatar, Egypt and Jordan).

## Decision

1. **No top-level tabs and no sort control**: the board's top bar keeps only the trip-type switch and the filter button, with the fare count below. Cards are always listed from the lowest price to the highest, each leading with its cheapest fare.
2. **One destination row**: `全部`, `日本`, `韓國`, `中港澳`, `東南亞`, `歐洲`, `美加`, `紐澳`, `中東`, each with a fare count that follows the other filters. Single choice; choosing the active one again clears it.
3. **`中港澳` is one area** (Hong Kong, Macau and mainland China), as asked; the rival board splits them.
4. **`中東` is added** (Turkey and the Emirates) so no fare is reachable only through `全部`.
5. **The country filter, the long-haul sub-region filter and the city list are removed.** A traveller who wants one country or city finds it in the card list.
6. **Web only**: areas are derived in the web app from each destination's country; the worker, API and database are unchanged, so the board's selection quotas still use the old five regions.

## Considered Options

- **Keep the country chips once an area is chosen**: Rejected for simplicity; it would keep a second level that the reference board does not have.
- **Split `港澳` and `中國`**: Rejected; one `中港澳` area was asked for.

## Consequences

- The long-haul sub-region and country filters shipped for ADR 0009 are deleted.
- Filtering to a single country or city is no longer possible; revisit if travellers ask for it.
