import { type DailyFlightItem, getDestinationMeta } from "@split/shared";

/** All fares for one destination city, cheapest first; `cheapest` is the card's summary fare. */
export interface CityGroup {
  cityKey: string;
  cheapest: DailyFlightItem;
  fares: DailyFlightItem[];
}

const byPrice = (a: DailyFlightItem, b: DailyFlightItem): number =>
  a.priceTwd - b.priceTwd || a.outDate.localeCompare(b.outDate);

/**
 * Groups fares by destination city (airports of one city share a card). Fares inside a card are
 * price-ascending; cards are ordered by their cheapest fare, a bigger discount first on a tie.
 */
export function groupByCity(items: readonly DailyFlightItem[]): CityGroup[] {
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

  return groups.sort(
    (a, b) =>
      a.cheapest.priceTwd - b.cheapest.priceTwd || b.cheapest.discountPct - a.cheapest.discountPct,
  );
}
