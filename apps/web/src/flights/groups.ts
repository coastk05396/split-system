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
 * Groups fares by destination city (airports of one city share a card) in one fixed order: each
 * card is placed by its cheapest fare, lowest price first (ties: higher discount).
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

const SOLID_BADGE_COUNT = 3;

/** Cities whose card gets the solid `省 X%` pill: the 3 highest discounts in view (ties: lower price). */
export function topDealCities(groups: readonly CityGroup[]): Set<string> {
  return new Set(
    groups
      .filter((g) => g.cheapest.tag !== "normal")
      .sort(
        (a, b) =>
          b.cheapest.discountPct - a.cheapest.discountPct ||
          a.cheapest.priceTwd - b.cheapest.priceTwd,
      )
      .slice(0, SOLID_BADGE_COUNT)
      .map((g) => g.cityKey),
  );
}
