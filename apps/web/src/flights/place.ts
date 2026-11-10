import { FLIGHT_DESTINATIONS, FLIGHT_ORIGINS } from "@split/shared";

const PLACES = [...FLIGHT_ORIGINS, ...FLIGHT_DESTINATIONS];

/**
 * The catalogue airport a typed code or city name (English or Traditional Chinese, exact match)
 * stands for; undefined for anything else, including countries, which the catalogue does not carry.
 */
export function findPlace(input: string): string | undefined {
  const q = input.trim().toLowerCase();
  if (!q) return undefined;
  return PLACES.find(
    (p) => p.airport.toLowerCase() === q || p.en.toLowerCase() === q || p.zhTW === q,
  )?.airport;
}
