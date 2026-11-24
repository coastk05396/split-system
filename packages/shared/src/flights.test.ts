import { describe, expect, it } from "vitest";
import {
  buildTripComUrl,
  computeArrivalTimeHm,
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
  isGhostFare,
  isRedEyeTime,
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

  it("detects red-eye flight times between 00:00 and 05:59", () => {
    expect(isRedEyeTime("00:15")).toBe(true);
    expect(isRedEyeTime("02:45")).toBe(true);
    expect(isRedEyeTime("2026-11-20T05:59:00+09:00")).toBe(true);
    expect(isRedEyeTime("06:00")).toBe(false);
    expect(isRedEyeTime("2026-11-20T14:30:00+08:00")).toBe(false);
    expect(isRedEyeTime("23:55")).toBe(false);
    expect(isRedEyeTime(null)).toBe(false);
    expect(isRedEyeTime(undefined)).toBe(false);
    expect(computeArrivalTimeHm("2026-12-01T19:00:00+08:00", 840, "LHR")).toBe("01:00");
    expect(computeArrivalTimeHm("2026-12-11T21:00:00+08:00", 210, "NRT")).toBe("01:30");
  });

  it("identifies ghost fares when verifier returns null or jumps > 20% and > NT$800", () => {
    expect(isGhostFare(4000, null)).toBe(true);
    expect(isGhostFare(4000, 5200)).toBe(true); // +30% and +1200
    expect(isGhostFare(4000, 4300)).toBe(false); // +7.5% and +300
    expect(isGhostFare(2500, 3200)).toBe(false); // +28% but only +700 (<= 800)
    expect(isGhostFare(10000, 11800)).toBe(false); // +1800 but only +18% (<= 20%)
  });

  it("computes deal signal tiers from baseline price", () => {
    expect(computeDealSignal(6500, 10000)).toEqual({ discountPct: 35, tag: "steal" });
    expect(computeDealSignal(7000, 10000)).toEqual({ discountPct: 30, tag: "steal" });
    expect(computeDealSignal(8200, 10000)).toEqual({ discountPct: 18, tag: "below_market" });
    expect(computeDealSignal(9500, 10000)).toEqual({ discountPct: 5, tag: "normal" });
    expect(computeDealSignal(11000, 10000)).toEqual({ discountPct: 0, tag: "normal" });
  });

  it("decides the Good Deal gate and the steal tier from the unrounded discount", () => {
    expect(computeDealSignal(8500, 10000)).toEqual({ discountPct: 15, tag: "below_market" });
    expect(computeDealSignal(8501, 10000).tag).toBe("normal"); // 14.99% never passes as 15%
    expect(computeDealSignal(7000, 10000).tag).toBe("steal");
    expect(computeDealSignal(7001, 10000).tag).toBe("below_market"); // 29.99% is not a steal
    expect(computeDealSignal(7040, 10000)).toEqual({ discountPct: 30, tag: "below_market" });
  });

  it("matches overlapping 2026 and 2027 Taiwan public holidays", () => {
    expect(matchTaiwanHoliday("2026-09-25", "2026-09-29")?.id).toBe("mid-autumn-2026");
    expect(matchTaiwanHoliday("2026-10-08", "2026-10-12")?.id).toBe("national-day-2026");
    expect(matchTaiwanHoliday("2027-02-05", "2027-02-11")?.id).toBe("cny-2027");
    expect(matchTaiwanHoliday("2027-04-02", "2027-04-06")?.id).toBe("qingming-2027");
    expect(matchTaiwanHoliday("2026-11-18", "2026-11-22")).toBeNull();
  });

  it("builds bilingual Trip.com showfarefirst URLs with city mapping and optional affiliate tags", () => {
    const zhUrl = buildTripComUrl({
      origin: "TPE",
      dest: "NRT",
      outDate: "2026-11-20",
      inDate: "2026-11-25",
      tripType: "rt",
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
        tripType: "ow",
        lang: "en",
      },
      { allianceId: "123456", sid: "789012" },
    );
    const parsed = new URL(enUrl);
    expect(parsed.origin).toBe("https://www.trip.com");
    expect(parsed.pathname).toBe("/flights/showfarefirst");
    expect(parsed.searchParams.get("dcity")).toBe("tpe");
    expect(parsed.searchParams.get("dairport")).toBe("TSA");
    expect(parsed.searchParams.get("acity")).toBe("tyo");
    expect(parsed.searchParams.get("aairport")).toBe("HND");
    expect(parsed.searchParams.get("ddate")).toBe("2026-12-05");
    expect(parsed.searchParams.get("rdate")).toBeNull();
    expect(parsed.searchParams.get("triptype")).toBe("ow");
    expect(parsed.searchParams.get("locale")).toBe("en-US");
    expect(parsed.searchParams.get("curr")).toBe("TWD");
    expect(parsed.searchParams.get("Allianceid")).toBe("123456");
    expect(parsed.searchParams.get("SID")).toBe("789012");
  });

  it("filters and sorts daily flights cleanly", () => {
    const sample = getDefaultDailyFlights("2026-11-16");
    expect(sample.length).toBeGreaterThanOrEqual(15);
    expect(sample[0]?.id.startsWith("2026-11-16-")).toBe(true);

    const jpDirect = filterDailyFlights(sample, {
      region: "jp",
      origin: "all",
      tripType: "all",
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
      { ...seed0, id: "c", transfers: 0, returnTransfers: 1 },
    ];
    expect(
      filterDailyFlights(custom, {
        region: "all",
        origin: "all",
        tripType: "all",
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
        tripType: "all",
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
        tripType: "all",
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
        tripType: "all",
        month: "all",
        directOnly: false,
        holidayOnly: false,
        maxPriceTwd: 6000,
      }).map((x) => x.id),
    ).toEqual(["a"]);
    expect(
      filterDailyFlights(
        [
          { ...seed0, id: "red", isRedEye: true },
          { ...seed0, id: "day", isRedEye: false },
        ],
        {
          region: "all",
          origin: "all",
          tripType: "all",
          month: "all",
          directOnly: false,
          holidayOnly: false,
          excludeRedEye: true,
        },
      ).map((x) => x.id),
    ).toEqual(["day"]);

    expect(
      filterDailyFlights(
        [
          { ...seed0, id: "mm-nrt", dest: "NRT", airlines: ["MM"] },
          { ...seed0, id: "ci-kix", dest: "KIX", airlines: ["CI", "JX"] },
        ],
        {
          region: "all",
          origin: "all",
          tripType: "all",
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
          tripType: "all",
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
      expect(d.baselineTwd, `${d.airport} baseline`).toBeGreaterThan(0);
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
      tripType: "rt",
      outDate: "2026-12-10",
      inDate: "2026-12-20",
      priceTwd: 30000,
      discountPct: 0,
      tag: "normal",
      airlines: ["CI"],
      transfers: 0,
      returnTransfers: 0,
      isRedEye: false,
      outboundDep: null,
      inboundDep: null,
    });
    const items = ["FCO", "VCE", "ORD", "LAX", "PER"].map(at);
    const base = {
      region: "longhaul",
      origin: "all",
      tripType: "all",
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
    };
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
    // Existing Long-haul destinations are unchanged
    expect(getDestinationMeta("LHR")).toMatchObject({ cityCode: "lon", baselineTwd: 31000 });
    expect(getDestinationMeta("SYD")).toMatchObject({ zhTW: "雪梨", baselineTwd: 25500 });
    expect(getAirlineName("BA", "zh-TW")).toBe("英國航空");
  });
});
