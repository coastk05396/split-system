import {
  DESTINATION_CATALOG,
  getDefaultDailyFlights,
  getDestinationMeta,
  type DailyFlightItem,
  type DailyFlightsResponse,
} from "@split/shared";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
  BASELINE_CANDIDATES_PER_ROUTE,
  MAX_DAILY_UPSTREAM_CALLS,
  MAX_DATES_PER_ROUTE,
  TRIP_QUOTAS,
} from "../src/flights/pipeline.js";
import { silentReplyClient } from "../src/line/reply-client.js";
import type { RateSource } from "../src/rates/rate-source.js";
import { clock, fakeVerifier } from "./auth-harness.js";

/** Raw-fetch fake month-matrix answer: a direct Baseline (median 32000) far above any test fare. */
function matrixResponse(): Response {
  return Response.json({
    success: true,
    data: [30000, 32000, 34000].map((value) => ({ value, number_of_changes: 0 })),
  });
}

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
  /** Stops on the outbound leg (and the return leg unless `returnTransfers` is set); default 0 (direct). */
  transfers?: number;
  returnTransfers?: number;
}

/** A month-matrix answer: `prices` are direct (0 changes), `connecting` ones have 1 change. */
interface MatrixAnswer {
  status?: number;
  success?: boolean;
  prices: number[];
  connecting?: number[];
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
  ) => MatrixAnswer | null,
  targeted?: (destination: string) => (FakeFare & { month: string })[],
) {
  const discoveries: { origin: string; oneWay: boolean; month: string; unique: string | null }[] =
    [];
  const monthMatrixCalls: MonthMatrixCall[] = [];
  const targetedCalls: { origin: string; destination: string }[] = [];
  let callCount = 0;
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
      transfers: fare.transfers ?? 0,
      return_transfers: fare.returnTransfers ?? fare.transfers ?? 0,
      duration_to: 180,
      duration_back: oneWay ? 0 : 180,
      // 4h before the (controllable) clock, so fares stay fresh when a test advances days.
      found_at: new Date(clock.now - 4 * 3_600_000).toISOString(),
    };
  };

  const fetchFn: typeof fetch = async (input) => {
    callCount += 1;
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
          success: result.success ?? true,
          data: [
            ...result.prices.map((value) => ({ value, changes: 0 })),
            ...(result.connecting ?? []).map((value) => ({ value, changes: 1 })),
          ].map(({ value, changes }, idx) => ({
            value,
            depart_date: `${month.slice(0, 7)}-${String(idx + 1).padStart(2, "0")}`,
            number_of_changes: changes,
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
      if (departure === "") {
        // Targeted discovery (origin + destination, no date): every date in the window
        targetedCalls.push({ origin, destination });
        const data = (targeted?.(destination) ?? []).map((f) => toItem(origin, false, f.month, f));
        return Response.json({ success: true, data });
      }
      verifyCount += 1;
      const month = departure.slice(0, 7);
      const day = Number(departure.slice(8, 10));
      const match =
        fares(origin, oneWay, month).find((f) => f.dest === destination && f.day === day) ??
        targeted?.(destination).find((f) => f.month === month && f.day === day);
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
    targetedCalls,
    stats: () => ({ verifyCount, maxInFlight, callCount }),
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
            dealBaselineTwd: 10000,
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
    const fake = fakeTravelpayouts(
      () => [
        { dest: "NRT", day: 5, price: 5000 },
        { dest: "NRT", day: 20, price: 5100 },
        { dest: "NRT", day: 25, price: 5200 },
      ],
      () => ({ prices: [8000, 9000, 10000] }),
    );

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

  describe("deal-first selection (ADR 0010)", { timeout: 30_000 }, () => {
    const cronNow = Date.parse("2026-11-16T00:00:00Z");
    const tpEnv = { ...env, TRAVELPAYOUTS_TOKEN: "tp-secret-token" };
    const DEC = "2026-12";

    beforeEach(async () => {
      await env.DB.prepare("DELETE FROM flight_baselines").run();
    });

    // Round-trip fares from TPE in the given months only (`fares(month)`), matrix per call.
    function tpeSupply(
      fares: (month: string) => FakeFare[],
      matrix: (destination: string, month: string) => MatrixAnswer,
    ) {
      return fakeTravelpayouts(
        (origin, oneWay, month) => (origin === "TPE" && !oneWay ? fares(month) : []),
        (_origin, destination, _oneWay, month) => matrix(destination, month),
      );
    }

    async function boardOf(fake: ReturnType<typeof fakeTravelpayouts>) {
      const db = createDb(env.DB);
      await refreshDailyFlights(
        db,
        productionFlightSource(tpEnv, fake.fetchFn, d1BaselineCache(db)),
        cronNow,
      );
      const res = await setupApp().request("https://split.test/api/v1/flights/daily", {}, env);
      return res.json<DailyFlightsResponse>();
    }

    it("keeps only fares at least 15% below their Baseline, and drops a fare with no Baseline", async () => {
      const fake = tpeSupply(
        (month) =>
          month === DEC
            ? [
                { dest: "NRT", day: 5, price: 7000 }, // 30% below 10000
                { dest: "NRT", day: 12, price: 8800 }, // 12% below: not a Good Deal
                { dest: "KIX", day: 6, price: 5000 }, // no Baseline from either source
              ]
            : [],
        (dest) => (dest === "NRT" ? { prices: [8000, 10000, 12000] } : { prices: [] }),
      );
      const board = await boardOf(fake);

      expect(board.isFallback).toBe(false);
      expect(board.items.map((i) => [i.dest, i.priceTwd, i.discountPct])).toEqual([
        ["NRT", 7000, 30],
      ]);
      expect(fake.stats().verifyCount).toBe(1); // dropped fares are never verified
    });

    it("scores a connecting fare against the connecting Baseline, not the cheaper direct mix", async () => {
      const fake = tpeSupply(
        (month) =>
          month === DEC
            ? [
                { dest: "NRT", day: 5, price: 7500 }, // direct: 25% below 10000
                { dest: "NRT", day: 12, price: 7000, transfers: 1 }, // connecting: 6.7% below 7500
              ]
            : [],
        () => ({ prices: [9000, 10000, 11000], connecting: [7000, 7500, 8000] }),
      );
      const { items } = await boardOf(fake);

      expect(items.map((i) => [i.priceTwd, i.transfers])).toEqual([[7500, 0]]);
    });

    it("drops a connecting candidate whose verification only finds a direct fare", async () => {
      const fake = tpeSupply(
        (month) =>
          month === DEC
            ? [
                { dest: "NRT", day: 5, price: 7000, transfers: 1 }, // 6.7% below 7500: no deal
                { dest: "NRT", day: 12, price: 5800, transfers: 1 }, // 22.7% below 7500
              ]
            : [],
        () => ({ prices: [9000, 10000, 11000], connecting: [7000, 7500, 8000] }),
      );
      // Verification answers with the same fares turned direct (the direct Baseline is 10000).
      const directOnly: typeof fetch = async (input, init) => {
        const res = await fake.fetchFn(input, init);
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        );
        if (url.pathname.includes("month-matrix") || !url.searchParams.get("destination"))
          return res;
        const body = await res.json<{ data: { transfers: number; return_transfers: number }[] }>();
        return Response.json({
          success: true,
          data: body.data.map((f) => ({ ...f, transfers: 0, return_transfers: 0 })),
        });
      };
      const db = createDb(env.DB);
      const items = await refreshDailyFlights(
        db,
        productionFlightSource(tpEnv, directOnly, d1BaselineCache(db)),
        cronNow,
      );

      expect(fake.stats().verifyCount).toBe(1);
      expect(items).toEqual([]);
    });

    it("drops any source's verified fare whose stop class changed", async () => {
      const source: FlightSource = {
        fetchCandidates: () =>
          Promise.resolve([
            {
              id: "class-change",
              origin: "TPE",
              dest: "NRT",
              tripType: "rt",
              outDate: "2026-12-10",
              inDate: "2026-12-14",
              priceTwd: 6000,
              dealBaselineTwd: 9000,
              airlines: ["IT"],
              transfers: 1,
              returnTransfers: 1,
              outboundDep: "09:40",
              inboundDep: "16:20",
            },
          ]),
        verifyCandidate: (c) =>
          Promise.resolve({ priceTwd: c.priceTwd, transfers: 0, returnTransfers: 0 }),
      };
      const collected = await collectVerifiedDailyFlights(source, cronNow);

      expect(collected.items).toEqual([]);
      expect(collected.droppedNull).toBe(1);
    });

    it("drops a fare with 3 or more stops on either leg and keeps 2 stops", async () => {
      const fake = tpeSupply(
        (month) =>
          month === DEC
            ? [
                { dest: "NRT", day: 5, price: 4000, transfers: 3 }, // outbound and return
                { dest: "NRT", day: 8, price: 4100, returnTransfers: 3 }, // return leg only
                { dest: "NRT", day: 12, price: 4200, transfers: 2 },
                { dest: "NRT", day: 15, price: 4300 },
              ]
            : [],
        () => ({ prices: [9000, 10000, 11000], connecting: [9000, 10000, 11000] }),
      );
      const { items } = await boardOf(fake);

      expect(items.map((i) => i.priceTwd)).toEqual([4200, 4300]);
      expect(fake.stats().verifyCount).toBe(2);
    });

    it("keeps a Route's 3 best-discount dates, not its 3 cheapest", async () => {
      const fake = tpeSupply(
        (month) =>
          month === DEC
            ? [5, 12, 19].map((day) => ({ dest: "NRT", day, price: 4000 })) // cheapest, 20% off 5000
            : month === "2027-01"
              ? [5, 12, 19].map((day) => ({ dest: "NRT", day, price: 4500 })) // 70% off 15000
              : [],
        (_dest, month) => ({
          prices: month === "2026-12-01" ? [4000, 5000, 6000] : [14000, 15000, 16000],
        }),
      );
      const { items } = await boardOf(fake);

      expect(items.map((i) => [i.outDate.slice(0, 7), i.discountPct])).toEqual([
        ["2027-01", 70],
        ["2027-01", 70],
        ["2027-01", 70],
      ]);
    });

    it("breaks equal discounts by lower price", async () => {
      const months = ["2026-12", "2027-01", "2027-02", "2027-03"];
      const price = [8000, 9600, 8800, 8400]; // all 20% below their month's Baseline
      const baseline = [10000, 12000, 11000, 10500];
      const fake = tpeSupply(
        (month) => {
          const i = months.indexOf(month);
          return i < 0 ? [] : [{ dest: "NRT", day: 5, price: price[i] ?? 0 }];
        },
        (_dest, month) => {
          const b = baseline[months.indexOf(month.slice(0, 7))] ?? 0;
          return { prices: [b - 1000, b, b + 1000] };
        },
      );
      const { items } = await boardOf(fake);

      expect(items.map((i) => i.priceTwd)).toEqual([8000, 8400, 8800]);
    });

    it("serves an empty board, not curated fares, after a completed run finds no Good Deal", async () => {
      const db = createDb(env.DB);
      await env.DB.prepare("DELETE FROM daily_flights").run();
      await env.DB.prepare("DELETE FROM daily_flights_runs").run();
      const app = setupApp();
      const get = async () =>
        (
          await app.request("https://split.test/api/v1/flights/daily", {}, env)
        ).json<DailyFlightsResponse>();

      expect((await get()).isFallback).toBe(true); // no run ever: curated reference fares

      const quiet = tpeSupply(
        (month) => (month === DEC ? [{ dest: "NRT", day: 5, price: 9500 }] : []), // 5% below
        () => ({ prices: [9000, 10000, 11000] }),
      );
      expect(await boardOf(quiet)).toMatchObject({ items: [], isFallback: false });

      // A failed run neither wipes nor marks anything.
      const failing: FlightSource = { fetchCandidates: () => Promise.reject(new Error("boom")) };
      await expect(refreshDailyFlights(db, failing, cronNow)).rejects.toThrow("boom");
      expect(await get()).toMatchObject({ items: [], isFallback: false });

      // A run that discovered nothing at all (no token / upstream down) is "unavailable", not "empty".
      await refreshDailyFlights(db, productionFlightSource({ TRAVELPAYOUTS_TOKEN: "" }), cronNow);
      expect((await get()).isFallback).toBe(true);
    });

    it("shows nothing for a country with only ordinary fares and never pads the board", async () => {
      const fake = tpeSupply(
        (month) =>
          month === DEC
            ? [
                { dest: "NRT", day: 5, price: 6000 },
                { dest: "NRT", day: 12, price: 6500 },
                ...[3, 6, 9, 12, 15].map((day) => ({ dest: "BKK", day, price: 4800 + day })),
              ]
            : [],
        (dest) => ({ prices: dest === "NRT" ? [9000, 10000, 11000] : [4000, 5000, 6000] }),
      );
      const { items, isFallback } = await boardOf(fake);

      expect(isFallback).toBe(false);
      expect(new Set(items.map((i) => i.dest))).toEqual(new Set(["NRT"]));
      expect(items).toHaveLength(2); // far below the 230 ceiling
    });

    it("fetches Baselines for the cheapest 6 candidates per Route when the call estimate is low", async () => {
      expect(BASELINE_CANDIDATES_PER_ROUTE).toBe(6);
      expect(MAX_DAILY_UPSTREAM_CALLS).toBe(800);
      const months = ["2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05"];
      const fake = tpeSupply(
        (month) =>
          months.includes(month)
            ? ["NRT", "ICN"].map((dest, i) => ({ dest, day: 3, price: 3000 + i * 100 }))
            : [],
        () => ({ prices: [20000, 30000, 40000] }),
      );
      await boardOf(fake);

      // 2 Routes x 6 dates, each in its own month: 12 calls, none dropped by a smaller shortlist
      expect(fake.monthMatrixCalls).toHaveLength(12);
    });

    it("shrinks the candidate count when the estimated upstream calls would pass 800, and keeps 230 as a ceiling ranked by discount", async () => {
      const dests = [
        ...["NRT", "HND", "KIX", "FUK", "CTS", "OKA", "ICN", "PUS", "CJU", "BKK"],
        ...["CNX", "SIN", "KUL", "HAN", "SGN", "DAD", "MNL", "DPS", "HKG", "PVG"],
      ];
      const months = ["2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05"];
      // Every origin x destination Route has one fare per month: 100 Routes x 6 months = 600 baseline
      // calls at 6 candidates per Route, far past the budget; dearer destinations get smaller discounts.
      const fake = fakeTravelpayouts(
        (origin, oneWay, month) =>
          oneWay || !months.includes(month) || !["TPE", "TSA", "KHH", "RMQ", "TNN"].includes(origin)
            ? []
            : dests.map((dest, i) => ({
                dest,
                day: 3,
                price: 3000 + i * 300 + months.indexOf(month),
              })),
        () => ({ prices: [10000, 12000, 14000] }),
      );
      const { items } = await boardOf(fake);
      const { callCount } = fake.stats();

      expect(callCount).toBeLessThanOrEqual(MAX_DAILY_UPSTREAM_CALLS);
      expect(fake.monthMatrixCalls.length).toBeLessThan(600);
      expect(fake.monthMatrixCalls.length).toBeGreaterThan(0);
      expect(items).toHaveLength(TRIP_QUOTAS.rt); // 100 Routes x 3 dates: cut to the ceiling
      const perDest = (dest: string) => items.filter((i) => i.dest === dest).length;
      expect(perDest("NRT")).toBe(5 * MAX_DATES_PER_ROUTE); // deepest discounts survive
      expect(perDest("PVG")).toBeLessThan(perDest("NRT")); // the dearest are cut first
    });
  });

  describe("board size ceiling and Route cap", { timeout: 30_000 }, () => {
    const cronNow = Date.parse("2026-11-16T00:00:00Z");
    const tpEnv = { ...env, TRAVELPAYOUTS_TOKEN: "tp-secret-token" };
    // 28 airports: 140 Routes of 3 Good Deals each, well past the ceiling.
    const dests = [
      ...["NRT", "HND", "KIX", "OKA", "FUK", "CTS", "NGO"],
      ...["ICN", "GMP", "PUS", "CJU", "TAE"],
      ...["BKK", "DMK", "DAD", "SIN", "SGN", "KUL"],
      ...["HKG", "MFM", "PVG", "SHA", "PEK"],
      ...["LHR", "CDG", "FRA", "LAX", "YVR", "SYD"],
    ];

    function bigSupply(destList: readonly string[]) {
      // December is the cheapest month by far: a pure cheapest-first pick would ignore later months.
      return fakeTravelpayouts(
        (_origin, _oneWay, month) =>
          destList.flatMap((dest, i) =>
            [3, 10, 17, 24].map((day) => ({
              dest,
              day,
              price:
                (month === "2026-12" ? 3000 : 6000 + Number(month.slice(5)) * 100) + i * 50 + day,
            })),
          ),
        () => ({ prices: [20000, 30000, 40000] }),
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

    it("caps the board at 225 round-trip and 5 one-way fares with at most 3 dates per route", async () => {
      expect(TRIP_QUOTAS).toEqual({ rt: 225, ow: 5 });
      expect(MAX_DATES_PER_ROUTE).toBe(3);

      const fake = bigSupply(dests);
      const items = await boardFor(fake);

      expect(items).toHaveLength(230);
      expect(items.filter((i) => i.tripType === "rt")).toHaveLength(225);
      expect(items.filter((i) => i.tripType === "ow")).toHaveLength(5);
      expect(fake.stats().verifyCount).toBe(230);

      // At most 3 dates per route per origin, so Hong Kong and Seoul cannot flood the board
      const perRoute = datesPerRoute(items);
      expect(Math.max(...perRoute.values())).toBe(MAX_DATES_PER_ROUTE);
      for (const dest of ["HKG", "ICN"]) {
        expect(
          items.filter((i) => i.dest === dest && i.tripType === "rt").length,
        ).toBeLessThanOrEqual(5 * MAX_DATES_PER_ROUTE);
      }
    });

    it("never exceeds a route's 3 dates, and stays below the ceiling when Good Deals are thin", async () => {
      // 4 airports x 5 origins x 3 dates = 60 rt fares at most, far below the 225 ceiling
      const items = await boardFor(bigSupply(["NRT", "ICN", "BKK", "HKG"]));

      expect(items.filter((i) => i.tripType === "rt")).toHaveLength(60);
      expect(items.filter((i) => i.tripType === "ow")).toHaveLength(5);
      expect(Math.max(...datesPerRoute(items).values())).toBe(MAX_DATES_PER_ROUTE);
    });
  });

  it("puts Curated Destinations on the board in their Flight Region and still drops unlisted airports", async () => {
    const fake = fakeTravelpayouts(
      (origin, oneWay, month) =>
        origin === "TPE" && !oneWay && month === "2026-12"
          ? [
              "HIJ",
              "HKD",
              "HKT",
              "BKI",
              "CTU",
              "KMG",
              "FCO",
              "KEF",
              "ORD",
              "HNL",
              "PER",
              "TFU",
            ].map((dest, i) => ({
              dest,
              day: 5 + i,
              price: 5000 + i * 100,
            }))
          : [],
      () => ({ prices: [20000, 30000, 40000] }),
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
      FCO: "longhaul",
      KEF: "longhaul",
      ORD: "longhaul",
      HNL: "longhaul",
      PER: "longhaul",
    }); // TFU (Chengdu Tianfu) is not curated: dropped, never an open-world airport
  });

  // Hundreds of sequential fake upstream calls and D1 writes per run: well past the 5s default.
  describe("per-route discovery feeds the deal-first board", { timeout: 30_000 }, () => {
    const cronNow = Date.parse("2026-11-16T00:00:00Z");
    const tpEnv = { ...env, TRAVELPAYOUTS_TOKEN: "tp-secret-token" };
    const longhaul = DESTINATION_CATALOG.filter((d) => d.region === "longhaul").map(
      (d) => d.airport,
    );
    const everyDate = (dests: readonly string[], price: number) =>
      dests.flatMap((dest, i) =>
        [3, 10, 17, 24].map((day) => ({ dest, day, price: price + i * 10 + day })),
      );
    // Long-haul fares for five months from TPE, far dearer than any short-haul fare
    const targeted = (dest: string) =>
      ["2026-12", "2027-01", "2027-02", "2027-03", "2027-04"].map((month, m) => ({
        dest,
        month,
        day: 8,
        price: 25000 + longhaul.indexOf(dest) * 100 + m,
      }));
    const stableMatrix = () => ({ prices: [40000, 50000, 60000] });

    beforeEach(async () => {
      await env.DB.prepare("DELETE FROM flight_baselines").run();
    });

    async function run(fake: ReturnType<typeof fakeTravelpayouts>, now = cronNow) {
      const db = createDb(env.DB);
      clock.now = now;
      await refreshDailyFlights(
        db,
        productionFlightSource(tpEnv, fake.fetchFn, d1BaselineCache(db)),
        now,
      );
      const res = await setupApp().request("https://split.test/api/v1/flights/daily", {}, env);
      return (await res.json<DailyFlightsResponse>()).items;
    }

    it("selects long-haul fares from targeted Taipei queries even when every generic result is short-haul", async () => {
      const fake = fakeTravelpayouts(() => everyDate(["NRT", "KIX"], 3000), stableMatrix, targeted);
      const items = await run(fake);

      // One round-trip query per curated long-haul airport from TPE, ahead of the other per-route queries
      expect(fake.targetedCalls.slice(0, longhaul.length)).toEqual(
        longhaul.map((destination) => ({ origin: "TPE", destination })),
      );
      expect(fake.discoveries.every((d) => d.month !== "")).toBe(true);
      const lh = items.filter((i) => i.region === "longhaul");
      expect(lh.length).toBeGreaterThan(0);
      expect(new Set(lh.map((i) => i.origin))).toEqual(new Set(["TPE"]));
    });

    describe("per-route discovery of popular destinations and every country", () => {
      const countries = [...new Set(DESTINATION_CATALOG.map((d) => d.countryCode))];
      const countryOf = (dest: string) => getDestinationMeta(dest)?.countryCode;
      // Hanoi fares exist only in the per-route answer: the broad per-origin query never sees them
      const hanoiOnly = (dest: string) =>
        dest === "HAN" ? [{ dest, month: "2026-12", day: 8, price: 4000 }] : [];

      it("queries every country at least once per run, popular destinations from every main origin", async () => {
        const fake = fakeTravelpayouts(() => [], stableMatrix);
        await run(fake);

        const queried = new Set(fake.targetedCalls.map((c) => countryOf(c.destination)));
        expect(countries.filter((c) => !queried.has(c))).toEqual([]);
        for (const origin of ["TPE", "TSA", "KHH", "RMQ", "TNN"]) {
          expect(fake.targetedCalls).toContainEqual({ origin, destination: "HAN" });
        }
        expect(fake.targetedCalls).toContainEqual({ origin: "TPE", destination: "MFM" });
        // No route is asked twice
        const keys = fake.targetedCalls.map((c) => `${c.origin}-${c.destination}`);
        expect(new Set(keys).size).toBe(keys.length);
      });

      it("finds a popular destination the broad query missed", async () => {
        const items = await run(
          fakeTravelpayouts(() => everyDate(["NRT"], 3000), stableMatrix, hanoiOnly),
        );

        expect(items.some((i) => i.dest === "HAN")).toBe(true);
      });

      it("skips a failed per-route query without failing the run", async () => {
        const fake = fakeTravelpayouts(() => [], stableMatrix, hanoiOnly);
        const failing: typeof fetch = (input, init) => {
          const url = new URL(
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          );
          if (
            url.searchParams.get("destination") === "HAN" &&
            !url.searchParams.has("departure_at")
          ) {
            return Promise.resolve(new Response("upstream error", { status: 500 }));
          }
          return fake.fetchFn(input, init);
        };
        const db = createDb(env.DB);
        const items = await refreshDailyFlights(
          db,
          productionFlightSource(tpEnv, failing, d1BaselineCache(db)),
          cronNow,
        );

        expect(items).toEqual([]);
        expect(fake.targetedCalls.some((c) => c.destination === "SGN")).toBe(true); // later queries still ran
      });

      it("reports the run's upstream call count in the summary log", async () => {
        const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
        try {
          const fake = fakeTravelpayouts(() => everyDate(["NRT"], 3000), stableMatrix);
          await run(fake);

          const summary = info.mock.calls
            .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
            .find((l) => l["event"] === "daily_flights_refresh_summary");
          expect(summary?.["upstreamCalls"]).toBe(fake.stats().callCount);
          expect(summary?.["countriesWithDeal"]).toBe(1); // NRT fares only: Japan
        } finally {
          info.mockRestore();
        }
      });
    });

    it("shows a smaller board, never padding, when only one region has Good Deals", async () => {
      const jp = ["NRT", "HND", "KIX"];
      const items = await run(fakeTravelpayouts(() => everyDate(jp, 3000), stableMatrix));

      expect(items.filter((i) => i.tripType === "rt")).toHaveLength(45); // 3 airports x 5 origins x 3 dates
      expect(items.filter((i) => i.tripType === "ow")).toHaveLength(TRIP_QUOTAS.ow);
      expect(items.every((i) => i.region === "jp")).toBe(true);
    });

    it("stays within the upstream call budget, and cached baselines cut it further", async () => {
      const supply = () => everyDate(["NRT", "ICN", "BKK", "HKG"], 3000);
      const cold = fakeTravelpayouts(supply, stableMatrix);
      const board = await run(cold);

      // 70 discovery + per-route queries + baselines + one verification per board fare
      const perRoute = cold.targetedCalls.length;
      expect(perRoute).toBeGreaterThan(longhaul.length);
      expect(cold.stats().verifyCount).toBe(board.length);
      expect(cold.stats().callCount).toBeLessThanOrEqual(MAX_DAILY_UPSTREAM_CALLS);

      const warm = fakeTravelpayouts(supply, stableMatrix);
      await run(warm, cronNow + 24 * 3_600_000);
      expect(warm.monthMatrixCalls).toHaveLength(0);
      expect(warm.stats().callCount).toBeLessThanOrEqual(
        cold.stats().callCount - cold.monthMatrixCalls.length,
      );
    }, 30_000);
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

    // BKK round trip: median 4900; fares under 15% off are not on the board
    expect(signal("BKK", "rt", 3000)).toEqual({ tag: "steal", discountPct: 39 });
    expect(signal("BKK", "rt", 4100)).toEqual({ tag: "below_market", discountPct: 16 });
    expect(signal("BKK", "rt", 4900)).toBeUndefined();
    expect(signal("BKK", "rt", 5600)).toBeUndefined();
    // BKK one way is scored against its own median (2500), not the round-trip one
    expect(signal("BKK", "ow", 1500)).toEqual({ tag: "steal", discountPct: 40 });
    expect(signal("BKK", "ow", 2600)).toBeUndefined();
    // HKG has only 2 candidates: too few to compare, so no Baseline and no place on the board
    expect(signal("HKG", "rt", 1000)).toBeUndefined();
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
    expect(fake.monthMatrixCalls).toHaveLength(2);
    for (const oneWay of [false, true]) {
      expect(fake.monthMatrixCalls).toContainEqual({
        origin: "TPE",
        destination: "NRT",
        oneWay,
        month: "2026-12-01",
        currency: "twd",
        showToAffiliates: "true",
      });
    }
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
    // HKG (network error + < 3 Stage 1 candidates) has no Baseline, so it is off the board
    expect(signal("HKG", 2000)).toBeUndefined();
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
    function bkkSupply(matrix?: () => MatrixAnswer | null) {
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

    // Whether the last `refreshAt` left an empty board, so the API served the curated fallback.
    let isFallback = false;

    async function refreshAt(fake: ReturnType<typeof bkkSupply>, now: number) {
      const db = createDb(env.DB);
      clock.now = now;
      await refreshDailyFlights(
        db,
        productionFlightSource(tpEnv, fake.fetchFn, d1BaselineCache(db)),
        now,
      );
      const res = await setupApp().request("https://split.test/api/v1/flights/daily", {}, env);
      const body = await res.json<DailyFlightsResponse>();
      isFallback = body.isFallback;
      return body.items.map((i) => ({ price: i.priceTwd, tag: i.tag, discountPct: i.discountPct }));
    }

    async function cachedBaselines() {
      const { results } = await env.DB.prepare(
        "SELECT origin, destination, trip_type, month, stop_class, baseline_twd FROM flight_baselines ORDER BY stop_class",
      ).all();
      return results;
    }

    // BKK rt in 2026-12: one direct fare (5000) and one connecting fare (4000), one upstream answer.
    function stopClassSupply(answer: MatrixAnswer) {
      return fakeTravelpayouts(
        (origin, oneWay, month) =>
          origin === "TPE" && !oneWay && month === "2026-12"
            ? [
                { dest: "BKK", day: 5, price: 5000 },
                { dest: "BKK", day: 12, price: 4000, transfers: 1 },
              ]
            : [],
        () => answer,
      );
    }

    it("scores a direct fare against the direct Baseline and a connecting fare against the connecting one", async () => {
      // direct median 8000, connecting median 5000; all six prices together would give 6000
      const fake = stopClassSupply({ prices: [6000, 8000, 10000], connecting: [4000, 5000, 6000] });
      const items = await refreshAt(fake, day0);

      expect(fake.monthMatrixCalls).toHaveLength(1); // one answer serves both stop classes
      expect(items).toContainEqual({ price: 5000, tag: "steal", discountPct: 38 });
      expect(items).toContainEqual({ price: 4000, tag: "below_market", discountPct: 20 });
    });

    it("keeps both stop classes for one Route and month for 3 days without overwriting each other", async () => {
      const first = stopClassSupply({
        prices: [6000, 8000, 10000],
        connecting: [4000, 5000, 6000],
      });
      const fresh = await refreshAt(first, day0);
      expect(await cachedBaselines()).toEqual([
        {
          origin: "TPE",
          destination: "BKK",
          trip_type: "rt",
          month: "2026-12-01",
          stop_class: "connecting",
          baseline_twd: 5000,
        },
        {
          origin: "TPE",
          destination: "BKK",
          trip_type: "rt",
          month: "2026-12-01",
          stop_class: "direct",
          baseline_twd: 8000,
        },
      ]);

      const second = stopClassSupply({ prices: [1, 2, 3], connecting: [1, 2, 3] });
      const cached = await refreshAt(second, day0 + 3 * DAY_MS);
      expect(second.monthMatrixCalls).toHaveLength(0);
      expect(cached).toEqual(fresh);
    });

    it("gives a stop class with fewer than 3 prices no Baseline, without touching the other class", async () => {
      const fake = stopClassSupply({ prices: [6000, 8000, 10000], connecting: [4000, 5000] });
      const items = await refreshAt(fake, day0);

      expect(items).toContainEqual({ price: 5000, tag: "steal", discountPct: 38 });
      // one connecting candidate only: too few for the Stage 1 fallback as well, so it is off the board
      expect(items.map((i) => i.price)).toEqual([5000]);
      expect((await cachedBaselines()).map((r) => [r["stop_class"], r["baseline_twd"]])).toEqual([
        ["connecting", null],
        ["direct", 8000],
      ]);
    });

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
      expect(await cachedBaselines()).toEqual([]); // a failed call is never cached
      // Only 2 Stage 1 candidates and no baseline: no Good Deal, so the board is empty, not curated
      expect(isFallback).toBe(false);
      expect(items).toEqual([]);
      expect(items).not.toContainEqual({ price: 4200, tag: "steal", discountPct: 40 });

      const recovered = bkkSupply();
      await refreshAt(recovered, day0 + DAY_MS);
      expect(recovered.monthMatrixCalls).toHaveLength(1);
    });

    it("treats an HTTP 200 success:false answer as a failure: not cached, retried and recovered next run", async () => {
      const bad = bkkSupply(() => ({ success: false, prices: [] }));
      await refreshAt(bad, day0);
      expect(isFallback).toBe(false); // discovered fares, no Baseline: a completed run, empty board

      const recovered = bkkSupply(); // median 7000
      const after = await refreshAt(recovered, day0 + DAY_MS);
      expect(recovered.monthMatrixCalls).toHaveLength(1);
      expect(after).toContainEqual({ price: 4200, tag: "steal", discountPct: 40 });
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
            dealBaselineTwd: 12000,
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
            dealBaselineTwd: 9000,
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
      tag: "steal", // 40% below its 9000 Baseline
    });
    expect(body.items[1]).toMatchObject({
      id: "valid-normal-rt",
      isRedEye: false,
      priceTwd: 7100, // verified price: 41% below its 12000 Baseline
      tag: "steal",
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
            dealBaselineTwd: item.priceTwd * 2,
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
      if (url.pathname.includes("month-matrix")) return Promise.resolve(matrixResponse());
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
      if (url.pathname.includes("month-matrix")) return Promise.resolve(matrixResponse());
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
      if (url.pathname.includes("month-matrix")) return Promise.resolve(matrixResponse());
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
      if (url.pathname.includes("month-matrix")) return Promise.resolve(matrixResponse());
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
    // 70 discovery + ~135 per-route calls + baselines + verifications, under the ~800 budget
    expect(fetchCount).toBeLessThanOrEqual(MAX_DAILY_UPSTREAM_CALLS);
    expect(items.length).toBeGreaterThanOrEqual(15);
    expect(items.length).toBeLessThanOrEqual(230);
  });

  it("skips discovery items whose found_at is already stale so fresher candidates keep Stage 2 quota", async () => {
    const cronNow = Date.parse("2026-11-16T03:00:00Z");
    const fakeFetch: typeof fetch = (input) => {
      const rawUrl =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(rawUrl);
      if (url.pathname.includes("month-matrix")) return Promise.resolve(matrixResponse());
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
            dealBaselineTwd: 9000,
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
    expect(formatDailyFlightsSyncSql([])).toBe(
      "DELETE FROM daily_flights;\nDELETE FROM daily_flights_runs;\n",
    );
    expect(formatDailyFlightsSyncSql([], { digestDate: "2026-11-16", at: 1 })).toContain(
      "INSERT OR REPLACE INTO daily_flights_runs",
    );
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
