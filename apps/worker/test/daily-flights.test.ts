import {
  getDefaultDailyFlights,
  type DailyFlightItem,
  type DailyFlightsResponse,
} from "@split/shared";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createDb } from "../src/db/client.js";
import { d1BaselineCache } from "../src/flights/baseline-cache.js";
import {
  listDailyFlights,
  productionFlightSource,
  refreshDailyFlights,
  type FlightSource,
} from "../src/flights/daily.js";
import {
  collectVerifiedDailyFlights,
  formatDailyFlightsSyncSql,
  MAX_DATES_PER_ROUTE,
  TRIP_QUOTAS,
} from "../src/flights/pipeline.js";
import { silentReplyClient } from "../src/line/reply-client.js";
import type { RateSource } from "../src/rates/rate-source.js";
import { clock, fakeVerifier } from "./auth-harness.js";

const noopRateSource: RateSource = {
  fetchRate: () => Promise.reject(new Error("unused in daily-flights tests")),
};

function setupApp(flightSource?: FlightSource) {
  return createApp({
    verifier: () => fakeVerifier,
    now: () => clock.now,
    rateSource: noopRateSource,
    lineReplyClient: () => silentReplyClient,
    ...(flightSource ? { flightSource: () => flightSource } : {}),
  });
}

interface FakeFare {
  dest: string;
  /** Day of month (1-28) in the queried month. */
  day: number;
  price: number;
  airline?: string;
}

function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface MonthMatrixCall {
  origin: string;
  destination: string;
  oneWay: boolean;
  month: string;
  currency: string | null;
  showToAffiliates: string | null;
}

/**
 * Fake Travelpayouts `prices_for_dates` + `month-matrix`: discovery (`departure_at=YYYY-MM`, no
 * destination) returns `fares(origin, oneWay, month)`; verification (`destination` + full date)
 * re-serves the same fare; `month-matrix` returns `monthMatrix(...)` prices when provided.
 */
function fakeTravelpayouts(
  fares: (origin: string, oneWay: boolean, month: string) => FakeFare[],
  monthMatrix?: (
    origin: string,
    destination: string,
    oneWay: boolean,
    month: string,
  ) => { status?: number; prices: number[] } | null,
) {
  const discoveries: { origin: string; oneWay: boolean; month: string; unique: string | null }[] =
    [];
  const monthMatrixCalls: MonthMatrixCall[] = [];
  let verifyCount = 0;
  let inFlight = 0;
  let maxInFlight = 0;

  const toItem = (origin: string, oneWay: boolean, month: string, fare: FakeFare) => {
    const outDate = `${month}-${String(fare.day).padStart(2, "0")}`;
    return {
      origin,
      destination: fare.dest,
      airline: fare.airline ?? "IT",
      departure_at: `${outDate}T10:00:00+08:00`,
      return_at: oneWay ? null : `${addDaysIso(outDate, 4)}T15:00:00+08:00`,
      price: fare.price,
      transfers: 0,
      return_transfers: 0,
      duration_to: 180,
      duration_back: oneWay ? 0 : 180,
      // 4h before the (controllable) clock, so fares stay fresh when a test advances days.
      found_at: new Date(clock.now - 4 * 3_600_000).toISOString(),
    };
  };

  const fetchFn: typeof fetch = async (input) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await Promise.resolve();
    try {
      const rawUrl =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(rawUrl);
      const origin = url.searchParams.get("origin") ?? "";
      const oneWay = url.searchParams.get("one_way") === "true";

      if (url.pathname.includes("month-matrix")) {
        const destination = url.searchParams.get("destination") ?? "";
        const month = url.searchParams.get("month") ?? "";
        monthMatrixCalls.push({
          origin,
          destination,
          oneWay,
          month,
          currency: url.searchParams.get("currency"),
          showToAffiliates: url.searchParams.get("show_to_affiliates"),
        });
        const result = monthMatrix
          ? monthMatrix(origin, destination, oneWay, month)
          : { prices: [] };
        if (result === null) {
          throw new Error("network error");
        }
        if (result.status && result.status >= 400) {
          return new Response("upstream error", { status: result.status });
        }
        return Response.json({
          success: true,
          data: result.prices.map((value, idx) => ({
            value,
            depart_date: `${month.slice(0, 7)}-${String(idx + 1).padStart(2, "0")}`,
            number_of_changes: 0,
          })),
        });
      }

      const departure = url.searchParams.get("departure_at") ?? "";
      const destination = url.searchParams.get("destination");
      if (destination === null) {
        discoveries.push({
          origin,
          oneWay,
          month: departure,
          unique: url.searchParams.get("unique"),
        });
        const data = fares(origin, oneWay, departure).map((f) =>
          toItem(origin, oneWay, departure, f),
        );
        return Response.json({ success: true, data });
      }
      verifyCount += 1;
      const month = departure.slice(0, 7);
      const day = Number(departure.slice(8, 10));
      const match = fares(origin, oneWay, month).find(
        (f) => f.dest === destination && f.day === day,
      );
      return Response.json({
        success: true,
        data: match ? [toItem(origin, oneWay, month, match)] : [],
      });
    } finally {
      inFlight -= 1;
    }
  };

  return {
    fetchFn,
    discoveries,
    monthMatrixCalls,
    stats: () => ({ verifyCount, maxInFlight }),
  };
}

describe("public flight routes and daily pipeline", () => {
  // The API clock is the 08:00 Taipei run time the pipeline tests refresh at (window 11-30..05-16)
  beforeEach(() => {
    clock.now = Date.parse("2026-11-16T00:00:00Z");
  });

  it("applies the 14-day to 6-month window to the API response: fallback fares and a cache that rolled past midnight", async () => {
    const db = createDb(env.DB);
    const app = setupApp();
    const get = async (now: number) => {
      clock.now = now;
      const res = await app.request("https://split.test/api/v1/flights/daily", {}, env);
      expect(res.status).toBe(200);
      return res.json<DailyFlightsResponse>();
    };
    const savedNow = clock.now;

    // Curated fallback: the fixed-date seeds outside the window (e.g. CNX 2027-06-09) are dropped
    const now = Date.parse("2026-11-16T00:00:00Z"); // window 2026-11-30..2027-05-16
    const fallback = await get(now);
    expect(fallback.isFallback).toBe(true);
    expect(fallback.items.length).toBeGreaterThan(0);
    for (const item of fallback.items) {
      expect(item.outDate >= "2026-11-30" && item.outDate <= "2027-05-16").toBe(true);
    }

    // A cached 08:00 digest: the day-14 fare is served, but is gone after the next midnight
    const day14: FlightSource = {
      fetchCandidates: (digestDate) =>
        Promise.resolve(
          ["2026-11-30", "2026-12-10"].map((outDate, idx) => ({
            id: `edge-${idx}`,
            origin: "TPE",
            dest: "NRT",
            tripType: "ow" as const,
            outDate,
            inDate: null,
            priceTwd: 5000 + idx,
            airlines: ["MM"],
            transfers: 0,
            returnTransfers: null,
            outboundDep: "10:00",
            inboundDep: null,
            digestDate,
          })),
        ),
      verifyCandidate: (candidate) => Promise.resolve({ priceTwd: candidate.priceTwd }),
    };
    await refreshDailyFlights(db, day14, now);
    expect((await get(now)).items.map((i) => i.outDate)).toEqual(["2026-11-30", "2026-12-10"]);
    const nextDay = await get(now + 86_400_000);
    expect(nextDay.items.map((i) => i.outDate)).toEqual(["2026-12-10"]);
    expect(nextDay.isFallback).toBe(false);
    clock.now = savedNow;
  });

  it("GET /flights/daily serves curated fallback deals when D1 has no verified digest", async () => {
    const db = createDb(env.DB);
    const seedEnv = { ...env, TRAVELPAYOUTS_TOKEN: "" };
    const seeded = await refreshDailyFlights(db, productionFlightSource(seedEnv), clock.now);
    expect(seeded).toEqual([]);

    const app = setupApp();
    const res = await app.request("https://split.test/api/v1/flights/daily", {}, seedEnv);
    expect(res.status).toBe(200);

    const body = await res.json<DailyFlightsResponse>();
    expect(body.isFallback).toBe(true);
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.items.length).toBeGreaterThanOrEqual(15);
    expect(body.items.some((item) => item.isRedEye)).toBe(true);
    expect(body.items.some((item) => item.region === "jp")).toBe(true);
    expect(body.items.some((item) => item.region === "longhaul")).toBe(true);
  });

  it("GET /flights/go redirects to bilingual Trip.com URLs and rejects invalid params", async () => {
    const app = setupApp();

    const zhRes = await app.request(
      "https://split.test/api/v1/flights/go?origin=TPE&dest=NRT&outDate=2026-12-01&inDate=2026-12-06&tripType=rt&lang=zh-TW",
      {},
      { ...env, TRIP_COM_ALLIANCE_ID: "111", TRIP_COM_SID: "222" },
    );
    expect(zhRes.status).toBe(302);
    expect(zhRes.headers.get("Cache-Control")).toBe("no-store");
    const zhLocation = zhRes.headers.get("Location");
    expect(zhLocation).toContain("https://tw.trip.com/flights/showfarefirst");
    expect(zhLocation).toContain("dcity=tpe");
    expect(zhLocation).toContain("acity=tyo");
    expect(zhLocation).toContain("aairport=NRT");
    expect(zhLocation).toContain("locale=zh-TW");
    expect(zhLocation).toContain("Allianceid=111");
    expect(zhLocation).toContain("SID=222");

    const enRes = await app.request(
      "https://split.test/api/v1/flights/go?origin=TSA&dest=HND&outDate=2026-12-05&tripType=ow&lang=en",
      {},
      env,
    );
    expect(enRes.status).toBe(302);
    const enLocation = enRes.headers.get("Location");
    expect(enLocation).toContain("https://www.trip.com/flights/showfarefirst");
    expect(enLocation).toContain("dairport=TSA");
    expect(enLocation).toContain("aairport=HND");
    expect(enLocation).toContain("locale=en-US");
    expect(enLocation).toContain("triptype=ow");

    const badRes = await app.request(
      "https://split.test/api/v1/flights/go?origin=https://evil.com&dest=NRT&outDate=2026-12-01&tripType=ow",
      {},
      env,
    );
    expect(badRes.status).toBe(400);
  });

  it("discovers once per departure month and never serves fares outside 14 days to 6 months, sequentially", async () => {
    const cronNow = Date.parse("2026-11-16T00:00:00Z"); // 08:00 Taipei; window 2026-11-30..2027-05-16
    const fake = fakeTravelpayouts(() => [
      { dest: "NRT", day: 5, price: 5000 },
      { dest: "NRT", day: 20, price: 5100 },
      { dest: "NRT", day: 25, price: 5200 },
    ]);

    const db = createDb(env.DB);
    const tpEnv = { ...env, TRAVELPAYOUTS_TOKEN: "tp-secret-token" };
    await refreshDailyFlights(db, productionFlightSource(tpEnv, fake.fetchFn), cronNow);

    const months = ["2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05"];
    for (const origin of ["TPE", "TSA", "KHH", "RMQ", "TNN"]) {
      for (const oneWay of [false, true]) {
        expect(
          fake.discoveries
            .filter((d) => d.origin === origin && d.oneWay === oneWay)
            .map((d) => d.month),
        ).toEqual(months);
      }
    }
    expect(fake.discoveries.every((d) => d.unique !== "true")).toBe(true);
    expect(fake.stats().maxInFlight).toBe(1);

    const res = await setupApp().request("https://split.test/api/v1/flights/daily", {}, env);
    const body = await res.json<DailyFlightsResponse>();
    expect(body.isFallback).toBe(false);
    expect(body.items.length).toBeGreaterThan(0);
    for (const item of body.items) {
      expect(item.outDate >= "2026-11-30").toBe(true);
      expect(item.outDate <= "2027-05-16").toBe(true);
    }
  });

  describe("board size and Route cap", () => {
    const cronNow = Date.parse("2026-11-16T00:00:00Z");
    const tpEnv = { ...env, TRAVELPAYOUTS_TOKEN: "tp-secret-token" };
    // 28 airports, every region with more route supply than its share of the quota.
    const dests = [
      ...["NRT", "HND", "KIX", "OKA", "FUK", "CTS", "NGO"],
      ...["ICN", "GMP", "PUS", "CJU", "TAE"],
      ...["BKK", "DMK", "DAD", "SIN", "SGN", "KUL"],
      ...["HKG", "MFM", "PVG", "SHA", "PEK"],
      ...["LHR", "CDG", "FRA", "LAX", "YVR", "SYD"],
    ];

    function bigSupply(destList: readonly string[]) {
      // December is the cheapest month by far: a pure cheapest-first pick would ignore later months.
      return fakeTravelpayouts((_origin, _oneWay, month) =>
        destList.flatMap((dest, i) =>
          [3, 10, 17, 24].map((day) => ({
            dest,
            day,
            price:
              (month === "2026-12" ? 3000 : 6000 + Number(month.slice(5)) * 100) + i * 50 + day,
          })),
        ),
      );
    }

    async function boardFor(fake: ReturnType<typeof bigSupply>) {
      await refreshDailyFlights(
        createDb(env.DB),
        productionFlightSource(tpEnv, fake.fetchFn),
        cronNow,
      );
      const res = await setupApp().request("https://split.test/api/v1/flights/daily", {}, env);
      return (await res.json<DailyFlightsResponse>()).items;
    }

    function datesPerRoute(items: readonly DailyFlightItem[]) {
      const perRoute = new Map<string, number>();
      for (const i of items) {
        const key = `${i.origin}-${i.dest}-${i.tripType}`;
        perRoute.set(key, (perRoute.get(key) ?? 0) + 1);
      }
      return perRoute;
    }

    it("fills 225 round-trip and 5 one-way fares across every month with at most 3 dates per route", async () => {
      expect(TRIP_QUOTAS).toEqual({ rt: 225, ow: 5 });
      expect(MAX_DATES_PER_ROUTE).toBe(3);

      const fake = bigSupply(dests);
      const items = await boardFor(fake);

      expect(items).toHaveLength(230);
      expect(items.filter((i) => i.tripType === "rt")).toHaveLength(225);
      expect(items.filter((i) => i.tripType === "ow")).toHaveLength(5);
      expect(fake.stats().verifyCount).toBe(230);

      // Hong Kong and Seoul no longer flood the board: at most 3 dates per route per origin
      const perRoute = datesPerRoute(items);
      expect(Math.max(...perRoute.values())).toBe(MAX_DATES_PER_ROUTE);
      for (const dest of ["HKG", "ICN"]) {
        expect(
          items.filter((i) => i.dest === dest && i.tripType === "rt").length,
        ).toBeLessThanOrEqual(5 * MAX_DATES_PER_ROUTE);
      }

      const rtMonths = new Set(
        items.filter((i) => i.tripType === "rt").map((i) => i.outDate.slice(0, 7)),
      );
      expect([...rtMonths].sort()).toEqual([
        "2026-12",
        "2027-01",
        "2027-02",
        "2027-03",
        "2027-04",
        "2027-05",
      ]);
      // Five one-way fares fall in five different months
      expect(
        new Set(items.filter((i) => i.tripType === "ow").map((i) => i.outDate.slice(0, 7))).size,
      ).toBe(5);
    });

    it("never exceeds a trip type's quota or a route's 3 dates when supply is thin", async () => {
      // 4 airports x 5 origins x 3 dates = 60 rt fares at most, far below the 225 quota
      const items = await boardFor(bigSupply(["NRT", "ICN", "BKK", "HKG"]));

      expect(items.filter((i) => i.tripType === "rt")).toHaveLength(60);
      expect(items.filter((i) => i.tripType === "ow")).toHaveLength(5);
      expect(Math.max(...datesPerRoute(items).values())).toBe(MAX_DATES_PER_ROUTE);
    });

    it("lets regions with plenty of supply take quota another region cannot fill", async () => {
      // Korea and Hong Kong/Macau/China have only 2 airports each: below their share of 225
      const thinKrHk = dests.filter(
        (d) => !["GMP", "PUS", "CJU", "TAE", "SHA", "PVG", "PEK"].includes(d),
      );
      const items = await boardFor(bigSupply(thinKrHk));

      expect(items.filter((i) => i.tripType === "rt")).toHaveLength(225);
      expect(Math.max(...datesPerRoute(items).values())).toBe(MAX_DATES_PER_ROUTE);
    });
  });

  it("puts Curated Destinations on the board in their Flight Region and still drops unlisted airports", async () => {
    const fake = fakeTravelpayouts((origin, oneWay, month) =>
      origin === "TPE" && !oneWay && month === "2026-12"
        ? ["HIJ", "HKD", "HKT", "BKI", "CTU", "KMG", "TFU"].map((dest, i) => ({
            dest,
            day: 5 + i,
            price: 5000 + i * 100,
          }))
        : [],
    );
    await refreshDailyFlights(
      createDb(env.DB),
      productionFlightSource({ ...env, TRAVELPAYOUTS_TOKEN: "tp-secret-token" }, fake.fetchFn),
      Date.parse("2026-11-16T00:00:00Z"),
    );
    const res = await setupApp().request("https://split.test/api/v1/flights/daily", {}, env);
    const { items } = await res.json<DailyFlightsResponse>();

    const regionOf = Object.fromEntries(items.map((i) => [i.dest, i.region]));
    expect(regionOf).toEqual({
      HIJ: "jp",
      HKD: "jp",
      HKT: "sea",
      BKI: "sea",
      CTU: "hkmo",
      KMG: "hkmo",
    }); // TFU (Chengdu Tianfu) is not curated: dropped, never an open-world airport
  });

  it("scores Deal Signal against the median of the day's candidates per destination and trip type", async () => {
    const cronNow = Date.parse("2026-11-16T00:00:00Z");
    const fake = fakeTravelpayouts((origin, oneWay, month) => {
      if (origin !== "TPE" || month !== "2026-12") return [];
      const rt = [3000, 4100, 4900, 5000, 5600].map((price, i) => ({
        dest: "BKK",
        day: 3 + i * 3,
        price,
      }));
      const ow = [1500, 2500, 2600].map((price, i) => ({ dest: "BKK", day: 4 + i * 3, price }));
      const thin = [1000, 2000].map((price, i) => ({ dest: "HKG", day: 5 + i * 3, price }));
      return oneWay ? ow : [...rt, ...thin];
    });

    const db = createDb(env.DB);
    const tpEnv = { ...env, TRAVELPAYOUTS_TOKEN: "tp-secret-token" };
    await refreshDailyFlights(db, productionFlightSource(tpEnv, fake.fetchFn), cronNow);
    const res = await setupApp().request("https://split.test/api/v1/flights/daily", {}, env);
    const { items } = await res.json<DailyFlightsResponse>();
    const signal = (dest: string, tripType: string, price: number) => {
      const item = items.find(
        (i) => i.dest === dest && i.tripType === tripType && i.priceTwd === price,
      );
      return item && { tag: item.tag, discountPct: item.discountPct };
    };

    // BKK round trip: median 4900
    expect(signal("BKK", "rt", 3000)).toEqual({ tag: "steal", discountPct: 39 });
    expect(signal("BKK", "rt", 4100)).toEqual({ tag: "below_market", discountPct: 16 });
    expect(signal("BKK", "rt", 4900)).toEqual({ tag: "normal", discountPct: 0 });
    // BKK one way is scored against its own median (2500), not the round-trip one
    expect(signal("BKK", "ow", 1500)).toEqual({ tag: "steal", discountPct: 40 });
    expect(signal("BKK", "ow", 2600)).toEqual({ tag: "normal", discountPct: 0 });
    // HKG has only 2 candidates: too few to compare, so no signal
    expect(signal("HKG", "rt", 1000)).toEqual({ tag: "normal", discountPct: 0 });
  });

  it("uses Travelpayouts month-matrix median as Deal Signal baseline when >= 3 prices are returned, deduplicated per (origin, dest, tripType, month)", async () => {
    const cronNow = Date.parse("2026-11-16T00:00:00Z");
    const fake = fakeTravelpayouts(
      (origin, oneWay, month) => {
        if (origin !== "TPE" || month !== "2026-12") return [];
        if (oneWay) {
          return [{ dest: "NRT", day: 5, price: 2100 }];
        }
        return [
          { dest: "NRT", day: 5, price: 4200 },
          { dest: "NRT", day: 12, price: 5600 },
        ];
      },
      (origin, destination, oneWay, month) => {
        if (origin === "TPE" && destination === "NRT" && month === "2026-12-01") {
          return oneWay
            ? { prices: [2000, 3000, 4000] } // median 3000
            : { prices: [4000, 6000, 8000, 10000] }; // median 7000
        }
        return { prices: [] };
      },
    );

    const db = createDb(env.DB);
    const tpEnv = { ...env, TRAVELPAYOUTS_TOKEN: "tp-secret-token" };
    await refreshDailyFlights(db, productionFlightSource(tpEnv, fake.fetchFn), cronNow);

    // Deduplicated: 2 rt candidates in 2026-12 -> 1 month-matrix call; 1 ow candidate -> 1 call
    expect(fake.monthMatrixCalls).toEqual([
      {
        origin: "TPE",
        destination: "NRT",
        oneWay: false,
        month: "2026-12-01",
        currency: "twd",
        showToAffiliates: "true",
      },
      {
        origin: "TPE",
        destination: "NRT",
        oneWay: true,
        month: "2026-12-01",
        currency: "twd",
        showToAffiliates: "true",
      },
    ]);
    expect(fake.stats().maxInFlight).toBe(1);

    const res = await setupApp().request("https://split.test/api/v1/flights/daily", {}, env);
    const { items } = await res.json<DailyFlightsResponse>();
    const signal = (tripType: string, price: number) => {
      const item = items.find(
        (i) => i.dest === "NRT" && i.tripType === tripType && i.priceTwd === price,
      );
      return item && { tag: item.tag, discountPct: item.discountPct };
    };

    // Even though Stage 1 only has 2 rt and 1 ow candidates, month-matrix provides >= 3 prices
    // 4200 vs 7000 = 40% (steal); 5600 vs 7000 = 20% (below_market); 2100 vs 3000 = 30% (steal)
    expect(signal("rt", 4200)).toEqual({ tag: "steal", discountPct: 40 });
    expect(signal("rt", 5600)).toEqual({ tag: "below_market", discountPct: 20 });
    expect(signal("ow", 2100)).toEqual({ tag: "steal", discountPct: 30 });
  });

  it("falls back to Stage 1 same-day median when month-matrix fails or returns fewer than 3 prices", async () => {
    const cronNow = Date.parse("2026-11-16T00:00:00Z");
    const fake = fakeTravelpayouts(
      (origin, oneWay, month) => {
        if (origin !== "TPE" || oneWay || month !== "2026-12") return [];
        // BKK has 3 Stage 1 candidates (median 5000); KIX has 3 (median 6000); HKG has 2 (< 3)
        return [
          { dest: "BKK", day: 3, price: 3000 },
          { dest: "BKK", day: 6, price: 5000 },
          { dest: "BKK", day: 9, price: 7000 },
          { dest: "KIX", day: 4, price: 4200 },
          { dest: "KIX", day: 8, price: 6000 },
          { dest: "KIX", day: 12, price: 8000 },
          { dest: "HKG", day: 5, price: 2000 },
          { dest: "HKG", day: 10, price: 4000 },
        ];
      },
      (_origin, destination) => {
        if (destination === "BKK") return { status: 500, prices: [] };
        if (destination === "KIX") return { prices: [1000, 2000] }; // < 3 items
        return null; // network error for HKG
      },
    );

    const db = createDb(env.DB);
    const tpEnv = { ...env, TRAVELPAYOUTS_TOKEN: "tp-secret-token" };
    await refreshDailyFlights(db, productionFlightSource(tpEnv, fake.fetchFn), cronNow);
    const res = await setupApp().request("https://split.test/api/v1/flights/daily", {}, env);
    const { items } = await res.json<DailyFlightsResponse>();
    const signal = (dest: string, price: number) => {
      const item = items.find((i) => i.dest === dest && i.priceTwd === price);
      return item && { tag: item.tag, discountPct: item.discountPct };
    };

    // BKK (HTTP 500) falls back to Stage 1 median 5000 -> 3000 is 40% off
    expect(signal("BKK", 3000)).toEqual({ tag: "steal", discountPct: 40 });
    // KIX (< 3 month-matrix prices) falls back to Stage 1 median 6000 -> 4200 is 30% off
    expect(signal("KIX", 4200)).toEqual({ tag: "steal", discountPct: 30 });
    // HKG (network error + < 3 Stage 1 candidates) has no signal
    expect(signal("HKG", 2000)).toEqual({ tag: "normal", discountPct: 0 });
  });

  describe("month-matrix baseline cache (3 days, D1)", () => {
    const DAY_MS = 24 * 3_600_000;
    const day0 = Date.parse("2026-11-16T00:00:00Z");
    const tpEnv = { ...env, TRAVELPAYOUTS_TOKEN: "tp-secret-token" };

    // D1 persists across tests in this file: start each case with an empty cache.
    beforeEach(async () => {
      await env.DB.prepare("DELETE FROM flight_baselines").run();
    });

    // BKK rt in 2026-12 only; the month-matrix answers `matrix(call)` (default median 7000).
    function bkkSupply(matrix?: () => { status?: number; prices: number[] } | null) {
      return fakeTravelpayouts(
        (origin, oneWay, month) =>
          origin === "TPE" && !oneWay && month === "2026-12"
            ? [
                { dest: "BKK", day: 5, price: 4200 },
                { dest: "BKK", day: 12, price: 5600 },
              ]
            : [],
        matrix ?? (() => ({ prices: [4000, 7000, 10000] })),
      );
    }

    async function refreshAt(fake: ReturnType<typeof bkkSupply>, now: number) {
      const db = createDb(env.DB);
      clock.now = now;
      await refreshDailyFlights(
        db,
        productionFlightSource(tpEnv, fake.fetchFn, d1BaselineCache(db)),
        now,
      );
      const res = await setupApp().request("https://split.test/api/v1/flights/daily", {}, env);
      const { items } = await res.json<DailyFlightsResponse>();
      return items.map((i) => ({ price: i.priceTwd, tag: i.tag, discountPct: i.discountPct }));
    }

    it("reuses a baseline fetched within 3 days with no new upstream call, and scores the same", async () => {
      const first = bkkSupply();
      const fresh = await refreshAt(first, day0);
      expect(first.monthMatrixCalls).toHaveLength(1);

      const second = bkkSupply(() => ({ prices: [1, 2, 3] })); // would change the signal if it were fetched
      const cached = await refreshAt(second, day0 + 3 * DAY_MS);
      expect(second.monthMatrixCalls).toHaveLength(0);
      expect(cached).toEqual(fresh);
      expect(fresh).toContainEqual({ price: 4200, tag: "steal", discountPct: 40 });
    });

    it("re-fetches and stores a baseline older than 3 days", async () => {
      await refreshAt(bkkSupply(), day0);

      const later = bkkSupply(() => ({ prices: [5000, 6000, 7000] })); // median 6000
      const items = await refreshAt(later, day0 + 3 * DAY_MS + 1);
      expect(later.monthMatrixCalls).toHaveLength(1);
      expect(items).toContainEqual({ price: 4200, tag: "steal", discountPct: 30 });

      const reused = bkkSupply();
      await refreshAt(reused, day0 + 4 * DAY_MS);
      expect(reused.monthMatrixCalls).toHaveLength(0);
    });

    it("falls back as before when the baseline fetch fails, and retries it next run", async () => {
      const failing = bkkSupply(() => ({ status: 500, prices: [] }));
      const items = await refreshAt(failing, day0);
      // Only 2 Stage 1 candidates and no baseline: no Deal Signal
      expect(items.every((i) => i.tag === "normal" && i.discountPct === 0)).toBe(true);

      const recovered = bkkSupply();
      await refreshAt(recovered, day0 + DAY_MS);
      expect(recovered.monthMatrixCalls).toHaveLength(1);
    });
  });

  it("drops ghost fares, keeps & tags red-eye flights, and serves persisted D1 deals", async () => {
    const fakeSource: FlightSource = {
      fetchCandidates: () =>
        Promise.resolve([
          {
            id: "valid-normal-rt",
            origin: "TPE",
            dest: "NRT",
            tripType: "rt",
            outDate: "2026-12-10",
            inDate: "2026-12-15",
            priceTwd: 6800,
            airlines: ["JX"],
            transfers: 0,
            returnTransfers: 0,
            outboundDep: "10:15",
            inboundDep: "15:20",
          },
          {
            id: "valid-redeye-rt",
            origin: "TPE",
            dest: "KIX",
            tripType: "rt",
            outDate: "2026-12-12",
            inDate: "2026-12-16",
            priceTwd: 5400,
            airlines: ["IT"],
            transfers: 0,
            returnTransfers: 0,
            outboundDep: "02:40",
            inboundDep: "19:30",
          },
          {
            id: "ghost-null-verify",
            origin: "TPE",
            dest: "BKK",
            tripType: "rt",
            outDate: "2026-12-18",
            inDate: "2026-12-22",
            priceTwd: 3500,
            airlines: ["FD"],
            transfers: 0,
            returnTransfers: 0,
            outboundDep: "13:00",
            inboundDep: "18:00",
          },
          {
            id: "ghost-price-jump",
            origin: "KHH",
            dest: "ICN",
            tripType: "rt",
            outDate: "2026-12-20",
            inDate: "2026-12-24",
            priceTwd: 4000,
            airlines: ["7C"],
            transfers: 0,
            returnTransfers: 0,
            outboundDep: "14:00",
            inboundDep: "11:00",
          },
        ]),
      verifyCandidate: (candidate) => {
        if (candidate.id === "ghost-null-verify") return Promise.resolve(null);
        if (candidate.id === "ghost-price-jump") return Promise.resolve({ priceTwd: 7200 });
        if (candidate.id === "valid-normal-rt") return Promise.resolve({ priceTwd: 7100 });
        return Promise.resolve({ priceTwd: candidate.priceTwd });
      },
    };

    const db = createDb(env.DB);
    await refreshDailyFlights(db, fakeSource, clock.now);

    const app = setupApp(fakeSource);
    const res = await app.request("https://split.test/api/v1/flights/daily", {}, env);
    expect(res.status).toBe(200);
    const body = await res.json<DailyFlightsResponse>();

    expect(body.isFallback).toBe(false);
    expect(body.items.map((x) => x.id)).toEqual(["valid-redeye-rt", "valid-normal-rt"]);
    expect(body.items[0]).toMatchObject({
      id: "valid-redeye-rt",
      isRedEye: true,
      priceTwd: 5400,
      tag: "normal", // no Stage 1 pool from a hand-built source, so no Deal Signal
    });
    expect(body.items[1]).toMatchObject({
      id: "valid-normal-rt",
      isRedEye: false,
      priceTwd: 7100,
      tag: "normal",
    });
  });

  it("chunks 20+ row verified digests across consecutive days without PK collisions", async () => {
    const db = createDb(env.DB);
    const verifiedBatchSource: FlightSource = {
      fetchCandidates: (digestDate) =>
        Promise.resolve(
          getDefaultDailyFlights(digestDate).map((item, idx) => ({
            id: `verified-${idx}-${item.origin}-${item.dest}`,
            origin: item.origin,
            dest: item.dest,
            tripType: item.tripType,
            outDate: item.outDate,
            inDate: item.inDate,
            priceTwd: item.priceTwd,
            airlines: item.airlines,
            transfers: item.transfers,
            returnTransfers: item.returnTransfers,
            outboundDep: item.outboundDep,
            inboundDep: item.inboundDep,
            digestDate,
          })),
        ),
      verifyCandidate: (candidate) => Promise.resolve({ priceTwd: candidate.priceTwd }),
    };

    const day1 = await refreshDailyFlights(db, verifiedBatchSource, clock.now);
    const day2 = await refreshDailyFlights(db, verifiedBatchSource, clock.now + 86_400_000);
    expect(day1.length).toBeGreaterThanOrEqual(20);
    expect(day2.length).toBe(day1.length);

    clock.now += 86_400_000;
    const res = await setupApp(verifiedBatchSource).request(
      "https://split.test/api/v1/flights/daily",
      {},
      env,
    );
    const body = await res.json<DailyFlightsResponse>();
    expect(body.isFallback).toBe(false);
    // The API serves only the window of the day it is read (2026-11-17: 12-01..2027-05-17)
    const inWindow = day2.filter((i) => i.outDate >= "2026-12-01" && i.outDate <= "2027-05-17");
    expect(inWindow.length).toBeGreaterThan(0);
    expect(body.items.length).toBe(inWindow.length);
  });

  it("verifies Travelpayouts deals via X-Access-Token, computes destination-tz arrival red-eyes, rejects mismatched directness, and falls back when stale", async () => {
    const cronNow = Date.parse("2026-11-16T00:00:00Z");
    const seenUrls: URL[] = [];
    const seenAuthHeaders: (string | null)[] = [];

    const fakeFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const rawUrl =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(rawUrl);
      seenUrls.push(url);
      const tokenHeader =
        init?.headers instanceof Headers
          ? init.headers.get("X-Access-Token")
          : ((init?.headers as Record<string, string> | undefined)?.["X-Access-Token"] ?? null);
      seenAuthHeaders.push(tokenHeader);

      const destination = url.searchParams.get("destination");
      if (destination === "BKK") {
        // Direct candidate only receives a connecting alternative -> must be rejected
        return Promise.resolve(
          Response.json({
            success: true,
            data: [
              {
                origin: "TPE",
                destination: "BKK",
                airline: "TG",
                departure_at: "2026-12-10T10:00:00+08:00",
                return_at: "2026-12-14T15:00:00+07:00",
                price: 3600,
                transfers: 1,
                return_transfers: 0,
              },
            ],
          }),
        );
      }
      if (destination === "LHR") {
        // TPE 19:00+08 + 840m = 01:00 in Europe/London -> arrival red-eye
        return Promise.resolve(
          Response.json({
            success: true,
            data: [
              {
                origin: "TPE",
                destination: "LHR",
                airline: "CI",
                departure_at: "2026-12-01T19:00:00+08:00",
                return_at: "2026-12-10T21:15:00+00:00",
                price: 19900,
                transfers: 0,
                return_transfers: 0,
                duration_to: 840,
                duration_back: 780,
                found_at: "2026-11-15T12:00:00Z",
              },
            ],
          }),
        );
      }
      if (url.searchParams.get("origin") === "TPE" && url.searchParams.get("one_way") === "false") {
        return Promise.resolve(
          Response.json({
            success: true,
            data: [
              {
                origin: "TPE",
                destination: "LHR",
                airline: "BR",
                departure_at: "2026-12-01T19:00:00+08:00",
                return_at: "2026-12-10T21:15:00+00:00",
                price: 19500,
                transfers: 0,
                return_transfers: 0,
                duration_to: 840,
                duration_back: 780,
              },
              {
                origin: "TPE",
                destination: "BKK",
                airline: "FD",
                departure_at: "2026-12-10T10:00:00+08:00",
                return_at: "2026-12-14T15:00:00+07:00",
                price: 3500,
                transfers: 0,
                return_transfers: 0,
              },
            ],
          }),
        );
      }
      return Promise.resolve(Response.json({ success: true, data: [] }));
    };

    const tpEnv = { ...env, TRAVELPAYOUTS_TOKEN: "tp-secret-token" };
    const db = createDb(env.DB);
    const items = await refreshDailyFlights(db, productionFlightSource(tpEnv, fakeFetch), cronNow);

    expect(seenUrls.length).toBeGreaterThan(0);
    expect(seenUrls.every((u) => !u.searchParams.has("token"))).toBe(true);
    expect(seenAuthHeaders.every((h) => h === "tp-secret-token")).toBe(true);
    expect(items.map((x) => x.dest)).toEqual(["LHR"]);
    expect(items[0]).toMatchObject({
      dest: "LHR",
      airlines: ["CI"],
      priceTwd: 19900,
      isRedEye: true,
    });

    // When all stored outDates are in the past relative to `now`, listDailyFlights falls back cleanly
    const staleResp = await listDailyFlights(db, Date.parse("2027-06-01T00:00:00Z"));
    expect(staleResp.isFallback).toBe(true);
    expect(staleResp.items.length).toBeGreaterThanOrEqual(15);
  });

  it("normalizes city codes using origin_airport/destination_airport and checks found_at against the actual verification clock", async () => {
    const cronNow = Date.parse("2026-11-15T16:30:00Z"); // 2026-11-16 00:30 in Asia/Taipei (UTC+8)
    const fakeFetch = (input: RequestInfo | URL): Promise<Response> => {
      const rawUrl =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(rawUrl);
      const origin = url.searchParams.get("origin");
      const destination = url.searchParams.get("destination");

      if (destination === "HND") {
        // 24h old at 2026-11-15T16:30:00Z (must pass even though digestDate is 2026-11-16 in UTC+8)
        return Promise.resolve(
          Response.json({
            success: true,
            data: [
              {
                origin: "TPE",
                origin_airport: "TSA",
                destination: "TYO",
                destination_airport: "HND",
                airline: "JL",
                departure_at: "2026-12-05T08:30:00+08:00",
                return_at: "2026-12-09T14:00:00+09:00",
                price: 6800,
                transfers: 0,
                return_transfers: 0,
                found_at: "2026-11-14T16:30:00Z",
              },
            ],
          }),
        );
      }
      if (destination === "NRT") {
        // 48h 1m old at 2026-11-15T16:30:00Z (must be rejected)
        return Promise.resolve(
          Response.json({
            success: true,
            data: [
              {
                origin: "TPE",
                origin_airport: "TPE",
                destination: "TYO",
                destination_airport: "NRT",
                airline: "JX",
                departure_at: "2026-12-06T09:00:00+08:00",
                return_at: "2026-12-10T15:00:00+09:00",
                price: 6500,
                transfers: 0,
                return_transfers: 0,
                found_at: "2026-11-13T16:29:00Z",
              },
            ],
          }),
        );
      }
      if (origin === "TPE" && url.searchParams.get("one_way") === "false") {
        return Promise.resolve(
          Response.json({
            success: true,
            data: [
              {
                origin: "TPE",
                origin_airport: "TSA",
                destination: "TYO",
                destination_airport: "HND",
                airline: "JL",
                departure_at: "2026-12-05T08:30:00+08:00",
                return_at: "2026-12-09T14:00:00+09:00",
                price: 6800,
                transfers: 0,
                return_transfers: 0,
              },
              {
                origin: "TPE",
                origin_airport: "TPE",
                destination: "TYO",
                destination_airport: "NRT",
                airline: "JX",
                departure_at: "2026-12-06T09:00:00+08:00",
                return_at: "2026-12-10T15:00:00+09:00",
                price: 6500,
                transfers: 0,
                return_transfers: 0,
              },
            ],
          }),
        );
      }
      return Promise.resolve(Response.json({ success: true, data: [] }));
    };

    const tpEnv = { ...env, TRAVELPAYOUTS_TOKEN: "tp-secret-token" };
    const db = createDb(env.DB);
    const items = await refreshDailyFlights(db, productionFlightSource(tpEnv, fakeFetch), cronNow);

    expect(items.map((x) => `${x.origin}-${x.dest}`)).toEqual(["TSA-HND"]);
    expect(items[0]).toMatchObject({
      origin: "TSA",
      dest: "HND",
      priceTwd: 6800,
      airlines: ["JL"],
    });
  });

  it("accepts Stage 2 fares when Travelpayouts v3 omits found_at, while still dropping malformed found_at timestamps", async () => {
    const cronNow = Date.parse("2026-11-15T16:30:00Z");
    const fakeFetch: typeof fetch = (input) => {
      const rawUrl =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(rawUrl);
      const destination = url.searchParams.get("destination");
      const origin = url.searchParams.get("origin");
      if (destination === "HND") {
        return Promise.resolve(
          Response.json({
            success: true,
            data: [
              {
                origin: "TPE",
                origin_airport: "TSA",
                destination: "TYO",
                destination_airport: "HND",
                airline: "JL",
                departure_at: "2026-12-05T08:30:00+08:00",
                return_at: "2026-12-09T14:00:00+09:00",
                price: 6800,
                transfers: 0,
                return_transfers: 0,
              },
            ],
          }),
        );
      }
      if (destination === "NRT") {
        return Promise.resolve(
          Response.json({
            success: true,
            data: [
              {
                origin: "TPE",
                origin_airport: "TPE",
                destination: "TYO",
                destination_airport: "NRT",
                airline: "JX",
                departure_at: "2026-12-06T09:00:00+08:00",
                return_at: "2026-12-10T15:00:00+09:00",
                price: 6500,
                transfers: 0,
                return_transfers: 0,
                found_at: "not-a-date",
              },
            ],
          }),
        );
      }
      if (origin === "TPE" && url.searchParams.get("one_way") === "false") {
        return Promise.resolve(
          Response.json({
            success: true,
            data: [
              {
                origin: "TPE",
                origin_airport: "TSA",
                destination: "TYO",
                destination_airport: "HND",
                airline: "JL",
                departure_at: "2026-12-05T08:30:00+08:00",
                return_at: "2026-12-09T14:00:00+09:00",
                price: 6800,
                transfers: 0,
                return_transfers: 0,
              },
              {
                origin: "TPE",
                origin_airport: "TPE",
                destination: "TYO",
                destination_airport: "NRT",
                airline: "JX",
                departure_at: "2026-12-06T09:00:00+08:00",
                return_at: "2026-12-10T15:00:00+09:00",
                price: 6500,
                transfers: 0,
                return_transfers: 0,
              },
            ],
          }),
        );
      }
      return Promise.resolve(Response.json({ success: true, data: [] }));
    };

    const tpEnv = { ...env, TRAVELPAYOUTS_TOKEN: "tp-secret-token" };
    const db = createDb(env.DB);
    const items = await refreshDailyFlights(db, productionFlightSource(tpEnv, fakeFetch), cronNow);

    expect(items.map((x) => `${x.origin}-${x.dest}`)).toEqual(["TSA-HND"]);
  });

  it("parses Travelpayouts one-way fares with duration_back: 0 and keeps total upstream fetches within the budget (discovery + baselines + verification)", async () => {
    const cronNow = Date.parse("2026-11-16T03:00:00Z");
    const destinations = [
      "NRT",
      "HND",
      "KIX",
      "OKA",
      "FUK",
      "CTS",
      "NGO",
      "ICN",
      "PUS",
      "BKK",
      "DAD",
      "SIN",
      "SGN",
      "KUL",
      "HKG",
      "MFM",
      "LHR",
      "CDG",
      "FRA",
      "LAX",
      "YVR",
      "SYD",
    ];
    let fetchCount = 0;

    const fakeFetch: typeof fetch = (input) => {
      const rawUrl =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(rawUrl);
      fetchCount += 1;
      if (url.pathname.includes("month-matrix")) {
        return Promise.resolve(Response.json({ success: true, data: [] }));
      }
      const origin = url.searchParams.get("origin") ?? "TPE";
      const destination = url.searchParams.get("destination");
      const oneWay = url.searchParams.get("one_way") === "true";

      if (destination !== null) {
        return Promise.resolve(
          Response.json({
            success: true,
            data: [
              {
                origin,
                destination,
                airline: "IT",
                departure_at: "2026-12-05T09:15:00+08:00",
                return_at: oneWay ? null : "2026-12-09T14:00:00+09:00",
                price: 3200,
                transfers: 0,
                return_transfers: oneWay ? 0 : 0,
                duration: 165,
                duration_to: 165,
                duration_back: oneWay ? 0 : 180,
                found_at: "2026-11-15T12:00:00Z",
              },
            ],
          }),
        );
      }

      // Return one-way fares with duration_back: 0 and round-trips across many destinations
      const data = destinations.map((dest, idx) => ({
        origin,
        destination: dest,
        airline: "IT",
        departure_at: "2026-12-05T09:15:00+08:00",
        return_at: oneWay ? null : "2026-12-09T14:00:00+09:00",
        price: 3200 + idx * 100,
        transfers: 0,
        return_transfers: 0,
        duration: 165,
        duration_to: 165,
        duration_back: oneWay ? 0 : 180,
        found_at: "2026-11-15T12:00:00Z",
      }));
      return Promise.resolve(Response.json({ success: true, data }));
    };

    const tpEnv = { ...env, TRAVELPAYOUTS_TOKEN: "tp-secret-token" };
    const db = createDb(env.DB);
    const items = await refreshDailyFlights(db, productionFlightSource(tpEnv, fakeFetch), cronNow);

    expect(items.some((item) => item.tripType === "ow")).toBe(true);
    // 70 discovery calls + <= 230 deduplicated month-matrix calls + <= 230 verify calls
    expect(fetchCount).toBeLessThanOrEqual(530);
    expect(items.length).toBeGreaterThanOrEqual(15);
    expect(items.length).toBeLessThanOrEqual(230);
  });

  it("skips discovery items whose found_at is already stale so fresher candidates keep Stage 2 quota", async () => {
    const cronNow = Date.parse("2026-11-16T03:00:00Z");
    const fakeFetch: typeof fetch = (input) => {
      const rawUrl =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(rawUrl);
      const origin = url.searchParams.get("origin");
      const destination = url.searchParams.get("destination");

      if (destination === "NRT") {
        return Promise.resolve(
          Response.json({
            success: true,
            data: [
              {
                origin: "TPE",
                destination: "NRT",
                airline: "JX",
                departure_at: "2026-12-08T09:00:00+08:00",
                return_at: "2026-12-12T15:00:00+09:00",
                price: 5900,
                transfers: 0,
                return_transfers: 0,
                duration_to: 185,
                duration_back: 215,
                found_at: "2026-11-15T20:00:00Z",
              },
            ],
          }),
        );
      }

      if (origin === "TPE" && url.searchParams.get("one_way") === "false") {
        return Promise.resolve(
          Response.json({
            success: true,
            data: [
              {
                origin: "TPE",
                destination: "KIX",
                airline: "IT",
                departure_at: "2026-12-05T08:00:00+08:00",
                return_at: "2026-12-09T14:00:00+09:00",
                price: 4200,
                transfers: 0,
                return_transfers: 0,
                found_at: "2026-11-10T00:00:00Z", // > 48h old at discovery
              },
              {
                origin: "TPE",
                destination: "NRT",
                airline: "JX",
                departure_at: "2026-12-08T09:00:00+08:00",
                return_at: "2026-12-12T15:00:00+09:00",
                price: 5900,
                transfers: 0,
                return_transfers: 0,
                found_at: "2026-11-15T20:00:00Z", // fresh
              },
            ],
          }),
        );
      }

      return Promise.resolve(Response.json({ success: true, data: [] }));
    };

    const tpEnv = { ...env, TRAVELPAYOUTS_TOKEN: "tp-secret-token" };
    const db = createDb(env.DB);
    const verifiedDests: string[] = [];
    const baseSource = productionFlightSource(tpEnv, fakeFetch);
    const wrappedSource: FlightSource = {
      fetchCandidates: (d, n) => baseSource.fetchCandidates(d, n),
      verifyCandidate: (cand, n) => {
        verifiedDests.push(cand.dest);
        return baseSource.verifyCandidate
          ? baseSource.verifyCandidate(cand, n)
          : Promise.resolve(null);
      },
    };
    const items = await refreshDailyFlights(db, wrappedSource, cronNow);

    expect(verifiedDests).toEqual(["NRT"]);
    expect(items.map((x) => x.dest)).toEqual(["NRT"]);
  });

  it("collectVerifiedDailyFlights and formatDailyFlightsSyncSql generate valid D1 SQL for manual sync", async () => {
    const cronNow = Date.parse("2026-11-16T00:00:00Z"); // 08:00 Taipei
    const source: FlightSource = {
      fetchCandidates: () =>
        Promise.resolve([
          {
            id: "manual-tpe-oka",
            origin: "TPE",
            dest: "OKA",
            tripType: "rt",
            outDate: "2026-12-10",
            inDate: "2026-12-14",
            priceTwd: 4590,
            airlines: ["MM"],
            transfers: 0,
            returnTransfers: 0,
            outboundDep: "09:40",
            inboundDep: "16:20",
          },
        ]),
    };

    const collected = await collectVerifiedDailyFlights(source, cronNow);
    expect(collected.items).toHaveLength(1);
    const sql = formatDailyFlightsSyncSql(collected.rows);
    expect(sql).toContain("DELETE FROM daily_flights;");
    expect(sql).toContain("INSERT INTO daily_flights");

    const db = createDb(env.DB);
    await env.DB.exec("DELETE FROM daily_flights;");
    for (const stmt of sql.split(";\n").filter((s) => s.trim().length > 0)) {
      await env.DB.prepare(stmt).run();
    }
    const resp = await listDailyFlights(db, cronNow);
    expect(resp.isFallback).toBe(false);
    expect(resp.items.map((i) => i.id)).toEqual(["manual-tpe-oka"]);

    // Verify empty-row DELETE-only SQL and single-quote escaping round-trip cleanly
    expect(formatDailyFlightsSyncSql([])).toBe("DELETE FROM daily_flights;\n");
    const [firstRow] = collected.rows;
    expect(firstRow).toBeDefined();
    if (firstRow) {
      const quotedSql = formatDailyFlightsSyncSql([{ ...firstRow, id: "id-with'quote" }]);
      expect(quotedSql).toContain("'id-with''quote'");
      expect(() => formatDailyFlightsSyncSql([{ ...firstRow, priceTwd: Number.NaN }])).toThrow(
        /Invalid numeric SQL literal/,
      );
    }
  });
});
