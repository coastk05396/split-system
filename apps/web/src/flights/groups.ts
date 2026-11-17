import { type DailyFlightItem, getDestinationMeta } from "@split/shared";

/** All fares for one destination city, cheapest first; `cheapest` is the card's summary fare. */
export interface CityGroup {
  cityKey: string;
  cheapest: DailyFlightItem;
  fares: DailyFlightItem[];
}

/** `best`: biggest discount first; `price`: lowest price first. Both rank the cheapest fare. */
export type CitySort = "best" | "price";

const byPrice = (a: DailyFlightItem, b: DailyFlightItem): number =>
  a.priceTwd - b.priceTwd || a.outDate.localeCompare(b.outDate);

const CARD_ORDER: Record<CitySort, (a: CityGroup, b: CityGroup) => number> = {
  best: (a, b) =>
    b.cheapest.discountPct - a.cheapest.discountPct || a.cheapest.priceTwd - b.cheapest.priceTwd,
  price: (a, b) =>
    a.cheapest.priceTwd - b.cheapest.priceTwd || b.cheapest.discountPct - a.cheapest.discountPct,
};

/**
 * Groups fares by destination city (airports of one city share a card). Fares inside a card are
 * always price-ascending; the cards themselves follow `sort`.
 */
export function groupByCity(
  items: readonly DailyFlightItem[],
  sort: CitySort = "price",
): CityGroup[] {
  const byCity = new Map<string, DailyFlightItem[]>();
  for (const item of items) {
    const key = getDestinationMeta(item.dest)?.cityCode ?? item.dest;
    byCity.set(key, [...(byCity.get(key) ?? []), item]);
  }

  const groups = [...byCity.entries()].flatMap(([cityKey, list]) => {
    const fares = [...list].sort(byPrice);
    const [cheapest] = fares;
    if (cheapest === undefined) return [];
    return [{ cityKey, cheapest, fares }];
  });

  return groups.sort(CARD_ORDER[sort]);
}
