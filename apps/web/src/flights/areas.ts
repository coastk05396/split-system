import { getDestinationMeta } from "@split/shared";

/** Destination areas of the Daily Flights filter (ADR 0011); web-only, derived from the country. */
export const FLIGHT_AREAS = ["jp", "kr", "hkcn", "sea", "europe", "na", "anz", "me"] as const;
export type FlightArea = (typeof FLIGHT_AREAS)[number];

const AREA_BY_COUNTRY: Readonly<Record<string, FlightArea>> = {
  JP: "jp",
  KR: "kr",
  HK: "hkcn",
  MO: "hkcn",
  CN: "hkcn",
  US: "na",
  CA: "na",
  AU: "anz",
  NZ: "anz",
  TR: "me",
  AE: "me",
};

/** The area of a destination airport, or `null` (shown under 全部 only) when its country is unmapped. */
export function flightAreaOf(dest: string): FlightArea | null {
  const meta = getDestinationMeta(dest);
  if (meta === null) return null;
  const byCountry = AREA_BY_COUNTRY[meta.countryCode];
  if (byCountry !== undefined) return byCountry;
  if (meta.region === "sea") return "sea";
  return meta.subRegion === "europe" ? "europe" : null;
}
