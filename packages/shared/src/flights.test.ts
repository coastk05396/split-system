import { describe, expect, it } from "vitest";
import {
  buildTripComUrl,
  flightGoQuerySchema,
  computeDealSignal,
  departureBounds,
  DESTINATION_CATALOG,
  filterDailyFlights,
  FLIGHT_REGIONS,
  getAirlineName,
  getAirportTimeZone,
  getCityName,
  getDefaultDailyFlights,
  getDestinationMeta,
  matchTaiwanHoliday,
  parseExploreAirlines,
  sortDailyFlights,
  withinDepartureWindow,
  type DailyFlightItem,
  LONGHAUL_SUBREGIONS,
  type DailyFlightsFilter,
  type DestinationMeta,
} from "./flights.js";

describe("flights domain helpers", () => {
  it("names Philippines AirAsia (Z2) in both languages, with a short English label that fits the card", () => {
    expect(getAirlineName("Z2", "zh-TW")).toBe("菲律賓亞洲航空");
    expect(getAirlineName("Z2", "en")).toBe("AirAsia PH");
  });

  it("scores the discount against the typical high price and tiers it at 50% and 15%", () => {
    expect(computeDealSignal(5000, 10000)).toEqual({ discountPct: 50, tag: "steal" });
    expect(computeDealSignal(2500, 10000)).toEqual({ discountPct: 75, tag: "steal" });
    expect(computeDealSignal(8500, 10000)).toEqual({ discountPct: 15, tag: "below_market" });
    expect(computeDealSignal(6500, 10000)).toEqual({ discountPct: 35, tag: "below_market" });
    expect(computeDealSignal(8600, 10000)).toEqual({ discountPct: 14, tag: "normal" });
    expect(computeDealSignal(9500, 10000)).toEqual({ discountPct: 5, tag: "normal" });
  });

  it("rounds the discount and tiers from the rounded value the traveler sees", () => {
    expect(computeDealSignal(5050, 10000)).toEqual({ discountPct: 50, tag: "steal" }); // 49.5% shows 50%
    expect(computeDealSignal(5051, 10000)).toEqual({ discountPct: 49, tag: "below_market" });
    expect(computeDealSignal(8549, 10000)).toEqual({ discountPct: 15, tag: "below_market" });
  });

  it("never shows a negative discount, and has none without a usable typical high", () => {
    expect(computeDealSignal(11000, 10000)).toEqual({ discountPct: 0, tag: "normal" });
    expect(computeDealSignal(10000, 10000)).toEqual({ discountPct: 0, tag: "normal" });
    expect(computeDealSignal(5000, 0)).toEqual({ discountPct: 0, tag: "normal" });
  });

  it("matches overlapping 2026 and 2027 Taiwan public holidays", () => {
    expect(matchTaiwanHoliday("2026-09-25", "2026-09-29")?.id).toBe("mid-autumn-2026");
    expect(matchTaiwanHoliday("2026-10-08", "2026-10-12")?.id).toBe("national-day-2026");
    expect(matchTaiwanHoliday("2027-02-05", "2027-02-11")?.id).toBe("cny-2027");
    expect(matchTaiwanHoliday("2027-04-02", "2027-04-06")?.id).toBe("qingming-2027");
    expect(matchTaiwanHoliday("2026-11-18", "2026-11-22")).toBeNull();
  });

  it("asks Trip.com for nonstop flights only when the fare is a Nonstop Fare", () => {
    const base = {
      origin: "TPE",
      dest: "SEA",
      outDate: "2027-01-12",
      inDate: "2027-01-19",
      lang: "en",
    } as const;
    const url = (nonstopOnly?: boolean) =>
      new URL(buildTripComUrl(nonstopOnly === undefined ? base : { ...base, nonstopOnly }));
    expect(url(true).origin).toBe("https://www.trip.com");
    expect(url(true).pathname).toBe("/flights/showfarefirst");
    expect(url(true).searchParams.get("nonstoponly")).toBe("on");
    expect(url(false).searchParams.get("nonstoponly")).toBe("off");
    expect(url().searchParams.get("nonstoponly")).toBe("off");
  });

  it("sends Fort Lauderdale to Trip.com as its own city while its City Card stays Miami's", () => {
    const parsed = new URL(
      buildTripComUrl({
        origin: "TPE",
        dest: "FLL",
        outDate: "2027-02-11",
        inDate: "2027-02-18",
        lang: "en",
      }),
    );
    expect(parsed.origin).toBe("https://www.trip.com");
    expect(parsed.pathname).toBe("/flights/showfarefirst");
    expect(parsed.searchParams.get("acity")).toBe("fll");
    expect(parsed.searchParams.has("aairport")).toBe(false);
    expect(getDestinationMeta("FLL")?.cityCode).toBe("mia");
  });

  it("builds bilingual Trip.com showfarefirst URLs with city mapping and optional affiliate tags", () => {
    const zhUrl = buildTripComUrl({
      origin: "TPE",
      dest: "NRT",
      outDate: "2026-11-20",
      inDate: "2026-11-25",
      lang: "zh-TW",
    });
    expect(zhUrl).toBe(
      "https://tw.trip.com/flights/showfarefirst?dcity=tpe&acity=tyo&ddate=2026-11-20&rdate=2026-11-25&triptype=rt&class=ys&quantity=1&nonstoponly=off&locale=zh-TW&curr=TWD&searchboxarg=t&lowpricesource=searchform&aairport=NRT",
    );

    const enUrl = buildTripComUrl(
      {
        origin: "TSA",
        dest: "HND",
        outDate: "2026-12-05",
        inDate: "2026-12-09",
        lang: "en",
      },
      { allianceId: "123456", sid: "789012", sub3: "345678" },
    );
    const parsed = new URL(enUrl);
    expect(parsed.origin).toBe("https://www.trip.com");
    expect(parsed.pathname).toBe("/flights/showfarefirst");
    expect(parsed.searchParams.get("dcity")).toBe("tpe");
    expect(parsed.searchParams.get("dairport")).toBe("TSA");
    expect(parsed.searchParams.get("acity")).toBe("tyo");
    expect(parsed.searchParams.get("aairport")).toBe("HND");
    expect(parsed.searchParams.get("ddate")).toBe("2026-12-05");
    expect(parsed.searchParams.get("rdate")).toBe("2026-12-09");
    expect(parsed.searchParams.get("triptype")).toBe("rt");
    expect(parsed.searchParams.get("locale")).toBe("en-US");
    expect(parsed.searchParams.get("curr")).toBe("TWD");
    expect(parsed.searchParams.get("Allianceid")).toBe("123456");
    expect(parsed.searchParams.get("SID")).toBe("789012");
    expect(parsed.searchParams.get("trip_sub1")).toBe("sprout-daily-flights");
    expect(parsed.searchParams.get("trip_sub3")).toBe("345678");
  });

  it("appends no affiliate parameters unless both Allianceid and SID are set", () => {
    const params = {
      origin: "TPE",
      dest: "NRT",
      outDate: "2026-11-20",
      inDate: "2026-11-25",
      lang: "zh-TW" as const,
    };
    for (const affiliate of [
      { allianceId: "1", sub3: "3" },
      { sid: "2", sub3: "3" },
      { sub3: "3" },
    ]) {
      expect(buildTripComUrl(params, affiliate)).not.toMatch(/Allianceid|SID|trip_sub/);
    }
    const withoutSub3 = new URL(buildTripComUrl(params, { allianceId: "1", sid: "2" }));
    expect(withoutSub3.searchParams.get("trip_sub1")).not.toBeNull();
    expect(withoutSub3.searchParams.has("trip_sub3")).toBe(false);
  });

  it("scores the curated fallback board against each destination's static baseline", () => {
    const sample = getDefaultDailyFlights("2026-11-16");
    expect(sample.length).toBeGreaterThan(0);
    for (const item of sample) {
      const baseline = getDestinationMeta(item.dest)?.baselineTwd ?? 0;
      expect(item.discountPct).toBe(computeDealSignal(item.priceTwd, baseline).discountPct);
    }
  });

  it("filters and sorts daily flights cleanly", () => {
    const sample = getDefaultDailyFlights("2026-11-16");
    expect(sample.length).toBeGreaterThanOrEqual(15);
    expect(sample[0]?.id.startsWith("2026-11-16-")).toBe(true);

    const jpDirect = filterDailyFlights(sample, {
      region: "jp",
      origin: "all",
      month: "all",
      directOnly: true,
      holidayOnly: false,
    });
    expect(jpDirect.length).toBeGreaterThan(0);
    for (const item of jpDirect) {
      expect(item.region).toBe("jp");
      expect(item.transfers).toBe(0);
    }

    const byPrice = sortDailyFlights(sample, "price");
    const byDiscount = sortDailyFlights(sample, "discount");
    const firstByPrice = byPrice[0];
    const lastByPrice = byPrice[byPrice.length - 1];
    const firstByDiscount = byDiscount[0];
    const lastByDiscount = byDiscount[byDiscount.length - 1];
    const seed0 = sample[0];
    if (!firstByPrice || !lastByPrice || !firstByDiscount || !lastByDiscount || !seed0) {
      throw new Error("Expected non-empty default daily flights");
    }
    expect(firstByPrice.priceTwd).toBeLessThanOrEqual(lastByPrice.priceTwd);
    expect(firstByDiscount.discountPct).toBeGreaterThanOrEqual(lastByDiscount.discountPct);

    const custom: DailyFlightItem[] = [
      { ...seed0, id: "a", priceTwd: 5000, discountPct: 20 },
      { ...seed0, id: "b", priceTwd: 15000, discountPct: 45 },
      { ...seed0, id: "c", transfers: 1 },
    ];
    expect(
      filterDailyFlights(custom, {
        region: "all",
        origin: "all",
        month: "all",
        directOnly: true,
        holidayOnly: false,
      }).map((x) => x.id),
    ).toEqual(["a", "b"]);

    const holidayDec: DailyFlightItem[] = [
      { ...seed0, id: "dec-normal", outDate: "2026-12-10", inDate: "2026-12-14" },
      { ...seed0, id: "dec-ny", outDate: "2026-12-31", inDate: "2027-01-04" },
      { ...seed0, id: "feb-228", outDate: "2027-02-26", inDate: "2027-03-02" },
    ];
    expect(
      filterDailyFlights(holidayDec, {
        region: "all",
        origin: "all",
        month: "2026-12",
        directOnly: false,
        holidayOnly: true,
      }).map((x) => x.id),
    ).toEqual(["dec-ny"]);
    expect(sortDailyFlights(custom.slice(0, 2), "price").map((x) => x.id)).toEqual(["a", "b"]);
    expect(sortDailyFlights(custom.slice(0, 2), "price", "desc").map((x) => x.id)).toEqual([
      "b",
      "a",
    ]);
    expect(sortDailyFlights(custom.slice(0, 2), "discount").map((x) => x.id)).toEqual(["b", "a"]);
    expect(sortDailyFlights(custom.slice(0, 2), "discount", "asc").map((x) => x.id)).toEqual([
      "a",
      "b",
    ]);
    expect(
      filterDailyFlights(custom, {
        region: "all",
        origin: "all",
        month: "all",
        directOnly: false,
        holidayOnly: false,
        stops: "transfer",
      }).map((x) => x.id),
    ).toEqual(["c"]);
    expect(
      filterDailyFlights(custom.slice(0, 2), {
        region: "all",
        origin: "all",
        month: "all",
        directOnly: false,
        holidayOnly: false,
        maxPriceTwd: 6000,
      }).map((x) => x.id),
    ).toEqual(["a"]);

    expect(
      filterDailyFlights(
        [
          { ...seed0, id: "mm-nrt", dest: "NRT", airlines: ["MM"] },
          { ...seed0, id: "ci-kix", dest: "KIX", airlines: ["CI", "JX"] },
        ],
        {
          region: "all",
          origin: "all",
          month: "all",
          directOnly: false,
          holidayOnly: false,
          dest: "kix",
        },
      ).map((x) => x.id),
    ).toEqual(["ci-kix"]);

    expect(
      filterDailyFlights(
        [
          { ...seed0, id: "mm-nrt", dest: "NRT", airlines: ["MM"] },
          { ...seed0, id: "ci-kix", dest: "KIX", airlines: ["CI", "JX"] },
        ],
        {
          region: "all",
          origin: "all",
          month: "all",
          directOnly: false,
          holidayOnly: false,
          airline: "jx",
        },
      ).map((x) => x.id),
    ).toEqual(["ci-kix"]);
  });

  it("keeps the departure window at tomorrow to 6 months, with month-end clamping, on curated fares too", () => {
    expect(departureBounds("2026-11-16")).toEqual({ from: "2026-11-17", to: "2027-05-16" });
    expect(departureBounds("2026-08-31")).toEqual({ from: "2026-09-01", to: "2027-02-28" });

    const early = withinDepartureWindow(getDefaultDailyFlights("2026-11-16"), "2026-11-16");
    expect(early.length).toBeGreaterThan(0);
    expect(early.some((f) => f.outDate === "2027-06-09")).toBe(false);
    const late = withinDepartureWindow(getDefaultDailyFlights("2027-02-01"), "2027-02-01");
    for (const f of early) expect(f.outDate >= "2026-11-17").toBe(true);
    for (const f of late) expect(f.outDate >= "2027-02-02").toBe(true);
  });

  it("keeps a fare departing tomorrow and drops today and anything past 6 months", () => {
    const fares = ["2026-11-16", "2026-11-17", "2027-05-16", "2027-05-17"].map((outDate) => ({
      outDate,
    }));
    expect(withinDepartureWindow(fares, "2026-11-16").map((f) => f.outDate)).toEqual([
      "2026-11-17",
      "2027-05-16",
    ]);
  });
});

describe("Explore airline parsing", () => {
  it("stores a single IATA airline_code as one carrier", () => {
    expect(parseExploreAirlines("IT", "Tigerair Taiwan")).toEqual(["IT"]);
    expect(parseExploreAirlines("it", undefined)).toEqual(["IT"]);
  });

  it("splits a multi-carrier name into IATA codes in order, keeping unknown names as fallback strings", () => {
    expect(parseExploreAirlines("multi", "Jetstar and Peach Aviation")).toEqual(["JQ", "MM"]);
    expect(parseExploreAirlines("multi", "Jetstar and Scoot")).toEqual(["JQ", "TR"]);
    expect(parseExploreAirlines("multi", "Air India, EVA Air, and Etihad")).toEqual([
      "Air India",
      "BR",
      "EY",
    ]);
  });

  it("deduplicates repeated carriers and ignores empty parts", () => {
    expect(parseExploreAirlines("multi", "EVA Air, EVA Air and Jetstar")).toEqual(["BR", "JQ"]);
    expect(parseExploreAirlines("multi", " and ")).toEqual([]);
  });

  it("returns no carrier when Explore names none, never the literal multi", () => {
    expect(parseExploreAirlines("multi", undefined)).toEqual([]);
    expect(parseExploreAirlines(undefined, undefined)).toEqual([]);
  });

  it("falls back to a recognised name when the code is absent, and shows a preserved name as is", () => {
    expect(parseExploreAirlines(undefined, "Peach Aviation")).toEqual(["MM"]);
    expect(getAirlineName("Air India", "en")).toBe("Air India");
    expect(getAirlineName("Air India", "zh-TW")).toBe("Air India");
    expect(getAirlineName("xx", "en")).toBe("XX");
  });
});

describe("Curated Destination catalog integrity", () => {
  const regionalIndicatorFlag = (countryCode: string) =>
    countryCode
      .split("")
      .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
      .join("");

  it("gives every airport unique, complete, localized metadata in a valid region", () => {
    const seen = new Set<string>();
    for (const d of DESTINATION_CATALOG) {
      expect(d.airport, "IATA code").toMatch(/^[A-Z]{3}$/);
      expect(seen.has(d.airport), `duplicate airport ${d.airport}`).toBe(false);
      seen.add(d.airport);
      expect(d.cityCode, `${d.airport} city code`).toMatch(/^[a-z]{3}$/);
      expect(d.countryCode, `${d.airport} country code`).toMatch(/^[A-Z]{2}$/);
      expect(d.flag, `${d.airport} flag matches ${d.countryCode}`).toBe(
        regionalIndicatorFlag(d.countryCode),
      );
      for (const name of [d.zhTW, d.en, d.countryZhTW, d.countryEn]) {
        expect(name.trim(), `${d.airport} names`).not.toBe("");
      }
      expect(/[一-鿿]/.test(d.zhTW), `${d.airport} zh-TW name`).toBe(true);
      expect(/[一-鿿]/.test(d.en), `${d.airport} English name`).toBe(false);
      expect(FLIGHT_REGIONS).toContain(d.region);
      expect(d.baselineTwd ?? 1, `${d.airport} baseline`).toBeGreaterThan(0);
    }
  });

  it("resolves a real IANA timezone for every airport", () => {
    for (const d of DESTINATION_CATALOG) {
      const zone = getAirportTimeZone(d.airport);
      expect(
        () => new Intl.DateTimeFormat("en-GB", { timeZone: zone }),
        `${d.airport} ${zone}`,
      ).not.toThrow();
    }
    expect(getAirportTimeZone("BKI")).toBe("Asia/Kuching");
    expect(getAirportTimeZone("HKT")).toBe("Asia/Bangkok");
    expect(getAirportTimeZone("CTU")).toBe("Asia/Shanghai");
  });

  it("merges airports of one city under one city code, and never mixes countries or regions in one", () => {
    const byCity = new Map<string, DestinationMeta[]>();
    for (const d of DESTINATION_CATALOG) {
      byCity.set(d.cityCode, [...(byCity.get(d.cityCode) ?? []), d]);
    }
    for (const [city, airports] of byCity) {
      expect(new Set(airports.map((a) => a.countryCode)).size, city).toBe(1);
      expect(new Set(airports.map((a) => a.region)).size, city).toBe(1);
    }
    const sharing = (...codes: string[]) =>
      new Set(codes.map((c) => getDestinationMeta(c)?.cityCode)).size;
    expect(sharing("NRT", "HND")).toBe(1);
    expect(sharing("PVG", "SHA")).toBe(1);
    expect(sharing("BKK", "DMK")).toBe(1);
    expect(sharing("ICN", "GMP")).toBe(1);
    expect(getDestinationMeta("XXX")).toBeNull();
  });

  it("puts every Long-haul airport in exactly one sub-region and no other airport in any", () => {
    for (const d of DESTINATION_CATALOG) {
      if (d.region === "longhaul") {
        expect(LONGHAUL_SUBREGIONS, d.airport).toContain(d.subRegion);
      } else {
        expect(d.subRegion, d.airport).toBeUndefined();
      }
    }
    const sub = (a: string) => getDestinationMeta(a)?.subRegion;
    expect([sub("FCO"), sub("ORD"), sub("PER"), sub("DXB")]).toEqual([
      "europe",
      "north_america",
      "oceania",
      "middle_east_islands",
    ]);
    // Every sub-region has airports
    for (const sr of LONGHAUL_SUBREGIONS) {
      expect(
        DESTINATION_CATALOG.some((d) => d.subRegion === sr),
        sr,
      ).toBe(true);
    }
  });

  it("filters by Long-haul sub-region and country", () => {
    const at = (dest: string): DailyFlightItem => ({
      id: dest,
      origin: "TPE",
      dest,
      region: "longhaul",
      outDate: "2026-12-10",
      inDate: "2026-12-20",
      priceTwd: 30000,
      discountPct: 0,
      tag: "normal",
      airlines: ["CI"],
      transfers: 0,
    });
    const items = ["FCO", "VCE", "ORD", "LAX", "PER"].map(at);
    const base = {
      region: "longhaul",
      origin: "all",
      month: "all",
      directOnly: false,
      holidayOnly: false,
    } as const;
    const dests = (f: Partial<DailyFlightsFilter>) =>
      filterDailyFlights(items, { ...base, ...f }).map((i) => i.dest);
    expect(dests({})).toEqual(["FCO", "VCE", "ORD", "LAX", "PER"]);
    expect(dests({ subRegion: "europe" })).toEqual(["FCO", "VCE"]);
    expect(dests({ subRegion: "north_america", country: "US" })).toEqual(["ORD", "LAX"]);
    expect(dests({ country: "IT" })).toEqual(["FCO", "VCE"]);
    expect(dests({ subRegion: "oceania", country: "US" })).toEqual([]);
    expect(dests({ subRegion: "all", country: "all" })).toHaveLength(5);
  });

  it("keeps city names short enough for a phone card", () => {
    for (const d of DESTINATION_CATALOG) {
      expect(getCityName(d.airport, "en").length, d.airport).toBeLessThanOrEqual(16);
    }
  });

  it("covers Japan regional, Southeast Asia and mainland China Curated Destinations", () => {
    const region = (code: string) => getDestinationMeta(code)?.region;
    for (const jp of ["HIJ", "HKD", "UKB", "OKJ", "SDJ", "FUK", "CTS"])
      expect(region(jp)).toBe("jp");
    for (const sea of ["HKT", "BKI", "PQC", "HDY"]) expect(region(sea)).toBe("sea");
    for (const cn of ["CTU", "KMG", "HRB"]) expect(region(cn)).toBe("hkmo");
    expect(getAirlineName("3U", "zh-TW")).toBe("四川航空");
  });

  it("covers Europe, North America and Oceania under Long-haul with correct country, flag and timezone", () => {
    const expected: Record<string, [string, string, string]> = {
      FCO: ["IT", "🇮🇹", "Europe/Rome"],
      MAD: ["ES", "🇪🇸", "Europe/Madrid"],
      PRG: ["CZ", "🇨🇿", "Europe/Prague"],
      MUC: ["DE", "🇩🇪", "Europe/Berlin"],
      ZRH: ["CH", "🇨🇭", "Europe/Zurich"],
      VCE: ["IT", "🇮🇹", "Europe/Rome"],
      BGY: ["IT", "🇮🇹", "Europe/Rome"],
      GVA: ["CH", "🇨🇭", "Europe/Zurich"],
      KEF: ["IS", "🇮🇸", "Atlantic/Reykjavik"],
      LAX: ["US", "🇺🇸", "America/Los_Angeles"],
      ORD: ["US", "🇺🇸", "America/Chicago"],
      SEA: ["US", "🇺🇸", "America/Los_Angeles"],
      HNL: ["US", "🇺🇸", "Pacific/Honolulu"],
      DFW: ["US", "🇺🇸", "America/Chicago"],
      IAD: ["US", "🇺🇸", "America/New_York"],
      PHX: ["US", "🇺🇸", "America/Phoenix"],
      YUL: ["CA", "🇨🇦", "America/Toronto"],
      CHC: ["NZ", "🇳🇿", "Pacific/Auckland"],
      PER: ["AU", "🇦🇺", "Australia/Perth"],
      // Europe and Middle East expansion (#210)
      BCN: ["ES", "🇪🇸", "Europe/Madrid"],
      MXP: ["IT", "🇮🇹", "Europe/Rome"],
      VIE: ["AT", "🇦🇹", "Europe/Vienna"],
      BER: ["DE", "🇩🇪", "Europe/Berlin"],
      BUD: ["HU", "🇭🇺", "Europe/Budapest"],
      CPH: ["DK", "🇩🇰", "Europe/Copenhagen"],
      DUB: ["IE", "🇮🇪", "Europe/Dublin"],
      EDI: ["GB", "🇬🇧", "Europe/London"],
      LIS: ["PT", "🇵🇹", "Europe/Lisbon"],
      OPO: ["PT", "🇵🇹", "Europe/Lisbon"],
      ATH: ["GR", "🇬🇷", "Europe/Athens"],
      BRU: ["BE", "🇧🇪", "Europe/Brussels"],
      ARN: ["SE", "🇸🇪", "Europe/Stockholm"],
      OSL: ["NO", "🇳🇴", "Europe/Oslo"],
      HEL: ["FI", "🇫🇮", "Europe/Helsinki"],
      WAW: ["PL", "🇵🇱", "Europe/Warsaw"],
      MAN: ["GB", "🇬🇧", "Europe/London"],
      NCE: ["FR", "🇫🇷", "Europe/Paris"],
      DOH: ["QA", "🇶🇦", "Asia/Qatar"],
      CAI: ["EG", "🇪🇬", "Africa/Cairo"],
      AMM: ["JO", "🇯🇴", "Asia/Amman"],
    };
    // North America and Oceania expansion (#211): no static baseline needed
    const expansion: Record<string, [string, string, string, string, string, string]> = {
      ATL: ["US", "north_america", "America/New_York", "亞特蘭大", "Atlanta", "atl"],
      BOS: ["US", "north_america", "America/New_York", "波士頓", "Boston", "bos"],
      LAS: ["US", "north_america", "America/Los_Angeles", "拉斯維加斯", "Las Vegas", "las"],
      DEN: ["US", "north_america", "America/Denver", "丹佛", "Denver", "den"],
      SAN: ["US", "north_america", "America/Los_Angeles", "聖地牙哥", "San Diego", "san"],
      PDX: ["US", "north_america", "America/Los_Angeles", "波特蘭", "Portland", "pdx"],
      ANC: ["US", "north_america", "America/Anchorage", "安克拉治", "Anchorage", "anc"],
      MIA: ["US", "north_america", "America/New_York", "邁阿密", "Miami", "mia"],
      IAH: ["US", "north_america", "America/Chicago", "休士頓", "Houston", "hou"],
      MCO: ["US", "north_america", "America/New_York", "奧蘭多", "Orlando", "orl"],
      YYZ: ["CA", "north_america", "America/Toronto", "多倫多", "Toronto", "yto"],
      YYC: ["CA", "north_america", "America/Edmonton", "卡加利", "Calgary", "yyc"],
      CUN: ["MX", "north_america", "America/Cancun", "坎昆", "Cancun", "cun"],
      MEX: ["MX", "north_america", "America/Mexico_City", "墨西哥城", "Mexico City", "mex"],
      BNE: ["AU", "oceania", "Australia/Brisbane", "布里斯本", "Brisbane", "bne"],
      ADL: ["AU", "oceania", "Australia/Adelaide", "阿得雷德", "Adelaide", "adl"],
      CBR: ["AU", "oceania", "Australia/Sydney", "坎培拉", "Canberra", "cbr"],
      OOL: ["AU", "oceania", "Australia/Brisbane", "黃金海岸", "Gold Coast", "ool"],
      CNS: ["AU", "oceania", "Australia/Brisbane", "凱恩斯", "Cairns", "cns"],
      HBA: ["AU", "oceania", "Australia/Hobart", "荷伯特", "Hobart", "hba"],
      WLG: ["NZ", "oceania", "Pacific/Auckland", "威靈頓", "Wellington", "wlg"],
      ZQN: ["NZ", "oceania", "Pacific/Auckland", "皇后鎮", "Queenstown", "zqn"],
    };
    for (const [airport, [country, sub, zone, zh, en, city]] of Object.entries(expansion)) {
      const meta = getDestinationMeta(airport);
      expect(meta, airport).toMatchObject({
        region: "longhaul",
        subRegion: sub,
        countryCode: country,
        cityCode: city,
      });
      expect(meta?.baselineTwd, `${airport} needs no static price`).toBeUndefined();
      expect(getAirportTimeZone(airport), airport).toBe(zone);
      expect([getCityName(airport, "zh-TW"), getCityName(airport, "en")], airport).toEqual([
        zh,
        en,
      ]);
    }
    expect(getDestinationMeta("CUN")).toMatchObject({
      flag: "🇲🇽",
      countryZhTW: "墨西哥",
      countryEn: "Mexico",
    });
    expect(getDestinationMeta("YYZ")?.zhTW).not.toBe(getDestinationMeta("YTZ")?.zhTW);
    for (const [airport, [country, flag, zone]] of Object.entries(expected)) {
      const meta = getDestinationMeta(airport);
      expect(meta?.region, airport).toBe("longhaul");
      expect([meta?.countryCode, meta?.flag, getAirportTimeZone(airport)], airport).toEqual([
        country,
        flag,
        zone,
      ]);
    }
    // Istanbul Sabiha, London Gatwick and Toronto City (ADR 0010)
    expect(
      Object.fromEntries(
        ["SAW", "LGW", "YTZ"].map((a) => {
          const m = getDestinationMeta(a);
          return [a, [m?.countryCode, m?.flag, m?.region, getAirportTimeZone(a)]];
        }),
      ),
    ).toEqual({
      SAW: ["TR", "🇹🇷", "longhaul", "Europe/Istanbul"],
      LGW: ["GB", "🇬🇧", "longhaul", "Europe/London"],
      YTZ: ["CA", "🇨🇦", "longhaul", "America/Toronto"],
    });
    expect(getDestinationMeta("SAW")?.zhTW).not.toBe(getDestinationMeta("IST")?.zhTW);
    // Sabiha and Gatwick share a City Card with Istanbul and London; Toronto has its own city name
    expect(getDestinationMeta("SAW")?.cityCode).toBe(getDestinationMeta("IST")?.cityCode);
    expect(getDestinationMeta("LGW")?.cityCode).toBe(getDestinationMeta("LHR")?.cityCode);
    expect([getCityName("SAW", "en"), getCityName("SAW", "zh-TW")]).toEqual([
      "Istanbul",
      "伊斯坦堡",
    ]);
    expect(getCityName("LGW", "zh-TW")).toBe("倫敦");
    expect([getCityName("YTZ", "en"), getCityName("YTZ", "zh-TW")]).toEqual(["Toronto", "多倫多"]);
    // Multi-airport cities render as one City Card name
    expect(getCityName("BGY", "en")).toBe("Milan");
    expect(getCityName("IAD", "zh-TW")).toBe("華盛頓");
    // Malpensa joins Bergamo's Milan City Card; the new cities need no static price
    expect(getDestinationMeta("MXP")?.cityCode).toBe(getDestinationMeta("BGY")?.cityCode);
    expect(getCityName("MXP", "zh-TW")).toBe("米蘭");
    expect(getDestinationMeta("DOH")).toMatchObject({ zhTW: "杜哈", countryZhTW: "卡達" });
    expect(getDestinationMeta("CAI")?.baselineTwd).toBeUndefined();
    expect(["DOH", "CAI", "AMM"].map((a) => getDestinationMeta(a)?.subRegion)).toEqual([
      "middle_east_islands",
      "middle_east_islands",
      "middle_east_islands",
    ]);
    // Existing Long-haul destinations are unchanged
    expect(getDestinationMeta("LHR")).toMatchObject({ cityCode: "lon", baselineTwd: 31000 });
    expect(getDestinationMeta("SYD")).toMatchObject({ zhTW: "雪梨", baselineTwd: 25500 });
    expect(getAirlineName("BA", "zh-TW")).toBe("英國航空");
  });

  it("resolves the nonstop-catalog airports (#220) to their city, country, region and timezone", () => {
    // airport: [country, flag, subRegion, timezone, City Card zh-TW, City Card en, city code]
    const added: Record<string, [string, string, string, string, string, string, string]> = {
      EWR: ["US", "🇺🇸", "north_america", "America/New_York", "紐約", "New York", "nyc"],
      KOA: ["US", "🇺🇸", "north_america", "Pacific/Honolulu", "科納", "Kona", "koa"],
      SLC: ["US", "🇺🇸", "north_america", "America/Denver", "鹽湖城", "Salt Lake City", "slc"],
      AUS: ["US", "🇺🇸", "north_america", "America/Chicago", "奧斯汀", "Austin", "aus"],
      SAT: ["US", "🇺🇸", "north_america", "America/Chicago", "聖安東尼奧", "San Antonio", "sat"],
      MSP: ["US", "🇺🇸", "north_america", "America/Chicago", "明尼亞波利斯", "Minneapolis", "msp"],
      PHL: ["US", "🇺🇸", "north_america", "America/New_York", "費城", "Philadelphia", "phl"],
      BNA: ["US", "🇺🇸", "north_america", "America/Chicago", "納什維爾", "Nashville", "bna"],
      PIT: ["US", "🇺🇸", "north_america", "America/New_York", "匹茲堡", "Pittsburgh", "pit"],
      FLL: ["US", "🇺🇸", "north_america", "America/New_York", "邁阿密", "Miami", "mia"],
      MSY: ["US", "🇺🇸", "north_america", "America/Chicago", "紐奧良", "New Orleans", "msy"],
      DTW: ["US", "🇺🇸", "north_america", "America/Detroit", "底特律", "Detroit", "dtt"],
      TPA: ["US", "🇺🇸", "north_america", "America/New_York", "坦帕", "Tampa", "tpa"],
      STL: ["US", "🇺🇸", "north_america", "America/Chicago", "聖路易", "St. Louis", "stl"],
      YOW: ["CA", "🇨🇦", "north_america", "America/Toronto", "渥太華", "Ottawa", "yow"],
      YHZ: ["CA", "🇨🇦", "north_america", "America/Halifax", "哈利法克斯", "Halifax", "yhz"],
      YWG: ["CA", "🇨🇦", "north_america", "America/Winnipeg", "溫尼伯", "Winnipeg", "ywg"],
      YEG: ["CA", "🇨🇦", "north_america", "America/Edmonton", "艾德蒙頓", "Edmonton", "yea"],
      NAP: ["IT", "🇮🇹", "europe", "Europe/Rome", "拿坡里", "Naples", "nap"],
      KRK: ["PL", "🇵🇱", "europe", "Europe/Warsaw", "克拉科夫", "Kraków", "krk"],
      GLA: ["GB", "🇬🇧", "europe", "Europe/London", "格拉斯哥", "Glasgow", "gla"],
      HAM: ["DE", "🇩🇪", "europe", "Europe/Berlin", "漢堡", "Hamburg", "ham"],
      MLA: ["MT", "🇲🇹", "europe", "Europe/Malta", "馬爾他", "Malta", "mla"],
      GUM: ["GU", "🇬🇺", "oceania", "Pacific/Guam", "關島", "Guam", "gum"],
      ROR: ["PW", "🇵🇼", "oceania", "Pacific/Palau", "帛琉", "Palau", "ror"],
      SPN: ["MP", "🇲🇵", "oceania", "Pacific/Saipan", "塞班", "Saipan", "spn"],
    };
    expect(Object.keys(added)).toHaveLength(26);
    for (const [airport, [country, flag, sub, zone, zh, en, city]] of Object.entries(added)) {
      const meta = getDestinationMeta(airport);
      expect(meta, airport).toMatchObject({
        region: "longhaul",
        subRegion: sub,
        countryCode: country,
        flag,
        cityCode: city,
      });
      expect(meta?.baselineTwd, `${airport} needs no static price`).toBeUndefined();
      expect(getAirportTimeZone(airport), airport).toBe(zone);
      expect([getCityName(airport, "zh-TW"), getCityName(airport, "en")], airport).toEqual([
        zh,
        en,
      ]);
    }
    // Newark shares New York's City Card, Fort Lauderdale shares Miami's
    expect(getDestinationMeta("EWR")?.cityCode).toBe(getDestinationMeta("JFK")?.cityCode);
    expect(getDestinationMeta("FLL")?.cityCode).toBe(getDestinationMeta("MIA")?.cityCode);
    expect(getCityName("MIA", "zh-TW")).toBe("邁阿密");
    expect(
      ["GUM", "ROR", "SPN"].map((a) => [
        getDestinationMeta(a)?.countryZhTW,
        getDestinationMeta(a)?.countryEn,
      ]),
    ).toEqual([
      ["關島", "Guam"],
      ["帛琉", "Palau"],
      ["北馬里亞納群島", "Northern Mariana Islands"],
    ]);
    expect(getDestinationMeta("MLA")).toMatchObject({ countryZhTW: "馬爾他", countryEn: "Malta" });
    expect(getDestinationMeta("SVO")).toBeNull(); // no Moscow
  });
});

describe("Trip.com redirect query", () => {
  const ok = { origin: "tpe", dest: "nrt", outDate: "2026-12-01", inDate: "2026-12-06" };

  it("normalizes a round trip from an active origin", () => {
    expect(flightGoQuerySchema.parse(ok)).toEqual({
      origin: "TPE",
      dest: "NRT",
      outDate: "2026-12-01",
      inDate: "2026-12-06",
      lang: "zh-TW",
      nonstopOnly: false,
    });
    expect(flightGoQuerySchema.parse({ ...ok, nonstopOnly: "1" }).nonstopOnly).toBe(true);
    expect(flightGoQuerySchema.safeParse({ ...ok, nonstopOnly: "yes" }).success).toBe(false);
  });

  it("requires the return date, a return not before departure, and an active origin", () => {
    expect(flightGoQuerySchema.safeParse({ ...ok, inDate: undefined }).success).toBe(false);
    expect(flightGoQuerySchema.safeParse({ ...ok, inDate: "" }).success).toBe(false);
    expect(flightGoQuerySchema.safeParse({ ...ok, inDate: "2026-11-30" }).success).toBe(false);
    expect(flightGoQuerySchema.safeParse({ ...ok, origin: "RMQ" }).success).toBe(false);
    expect(flightGoQuerySchema.safeParse({ ...ok, origin: "https://evil.com" }).success).toBe(
      false,
    );
  });
});
