import { describe, expect, it } from "vitest";
import {
  buildTripComUrl,
  computeDealSignal,
  filterDailyFlights,
  getDefaultDailyFlights,
  isGhostFare,
  isRedEyeTime,
  matchTaiwanHoliday,
  sortDailyFlights,
  type DailyFlightItem,
} from "./flights.js";

describe("flights domain helpers", () => {
  it("detects red-eye flight times between 00:00 and 05:59", () => {
    expect(isRedEyeTime("00:15")).toBe(true);
    expect(isRedEyeTime("02:45")).toBe(true);
    expect(isRedEyeTime("2026-11-20T05:59:00+09:00")).toBe(true);
    expect(isRedEyeTime("06:00")).toBe(false);
    expect(isRedEyeTime("2026-11-20T14:30:00+08:00")).toBe(false);
    expect(isRedEyeTime("23:55")).toBe(false);
    expect(isRedEyeTime(null)).toBe(false);
    expect(isRedEyeTime(undefined)).toBe(false);
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
    expect(sortDailyFlights(custom.slice(0, 2), "price").map((x) => x.id)).toEqual(["a", "b"]);
    expect(sortDailyFlights(custom.slice(0, 2), "discount").map((x) => x.id)).toEqual(["b", "a"]);
  });
});
