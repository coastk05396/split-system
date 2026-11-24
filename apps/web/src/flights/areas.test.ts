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
    ["ES", "europe"],
    ["AT", "europe"],
    ["HU", "europe"],
    ["DK", "europe"],
    ["IE", "europe"],
    ["PT", "europe"],
    ["GR", "europe"],
    ["BE", "europe"],
    ["SE", "europe"],
    ["NO", "europe"],
    ["FI", "europe"],
    ["PL", "europe"],
    ["US", "na"],
    ["CA", "na"],
    ["AU", "anz"],
    ["NZ", "anz"],
    ["TR", "me"],
    ["AE", "me"],
    ["QA", "me"],
    ["EG", "me"],
    ["JO", "me"],
    ["MX", null],
  ] as const)("puts %s in %s", (country, area) => {
    expect(areaOfCountry(country)).toBe(area);
  });

  it("puts the North America and Oceania expansion cities in their areas, Mexico under 全部 only", () => {
    for (const a of ["ATL", "BOS", "LAS", "DEN", "SAN", "PDX", "ANC", "MIA", "IAH", "MCO"])
      expect(flightAreaOf(a), a).toBe("na");
    for (const a of ["YYZ", "YYC"]) expect(flightAreaOf(a), a).toBe("na");
    for (const a of ["BNE", "ADL", "CBR", "OOL", "CNS", "HBA", "WLG", "ZQN"])
      expect(flightAreaOf(a), a).toBe("anz");
    expect([flightAreaOf("CUN"), flightAreaOf("MEX")]).toEqual([null, null]);
  });

  it("maps every catalog destination to an area, except the countries left under 全部 only", () => {
    const underAllOnly = new Set(["MX"]);
    for (const d of DESTINATION_CATALOG) {
      if (underAllOnly.has(d.countryCode)) expect(flightAreaOf(d.airport)).toBeNull();
      else expect(FLIGHT_AREAS).toContain(flightAreaOf(d.airport));
    }
    expect(flightAreaOf("ZZZ")).toBeNull();
  });
});
