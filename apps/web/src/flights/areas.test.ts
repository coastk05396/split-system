import { DESTINATION_CATALOG } from "@split/shared";
import { describe, expect, it } from "vitest";
import { FLIGHT_AREAS, flightAreaOf } from "./areas.js";

const areaOfCountry = (code: string) => {
  const meta = DESTINATION_CATALOG.find((d) => d.countryCode === code);
  return meta === undefined ? undefined : flightAreaOf(meta.airport);
};

describe("flightAreaOf", () => {
  it.each([
    ["JP", "jp"],
    ["KR", "kr"],
    ["HK", "hkcn"],
    ["MO", "hkcn"],
    ["CN", "hkcn"],
    ["TH", "sea"],
    ["SG", "sea"],
    ["MY", "sea"],
    ["VN", "sea"],
    ["PH", "sea"],
    ["ID", "sea"],
    ["GB", "europe"],
    ["IT", "europe"],
    ["IS", "europe"],
    ["US", "na"],
    ["CA", "na"],
    ["AU", "anz"],
    ["NZ", "anz"],
    ["TR", "me"],
    ["AE", "me"],
  ] as const)("puts %s in %s", (country, area) => {
    expect(areaOfCountry(country)).toBe(area);
  });

  it("maps every catalog destination to an area, and an unknown airport to none", () => {
    for (const d of DESTINATION_CATALOG) {
      expect(FLIGHT_AREAS).toContain(flightAreaOf(d.airport));
    }
    expect(flightAreaOf("ZZZ")).toBeNull();
  });
});
