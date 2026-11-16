import { getDefaultDailyFlights, type DailyFlightsResponse } from "@split/shared";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createDb } from "../src/db/client.js";
import {
  collectVerifiedDailyFlights,
  formatDailyFlightsSyncSql,
  listDailyFlights,
  productionFlightSource,
  refreshDailyFlights,
  type FlightSource,
} from "../src/flights/daily.js";
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

describe("public flight routes and daily pipeline", () => {
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
      tag: "steal",
    });
    expect(body.items[1]).toMatchObject({
      id: "valid-normal-rt",
      isRedEye: false,
      priceTwd: 7100,
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

    const res = await setupApp(verifiedBatchSource).request(
      "https://split.test/api/v1/flights/daily",
      {},
      env,
    );
    const body = await res.json<DailyFlightsResponse>();
    expect(body.isFallback).toBe(false);
    expect(body.items.length).toBe(day2.length);
  });

  it("verifies Travelpayouts deals via X-Access-Token, computes destination-tz arrival red-eyes, rejects mismatched directness, and falls back when stale", async () => {
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
    const items = await refreshDailyFlights(
      db,
      productionFlightSource(tpEnv, fakeFetch),
      clock.now,
    );

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

  it("drops Stage 2 fares missing found_at or with malformed found_at timestamps", async () => {
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

    expect(items).toHaveLength(0);
  });

  it("parses Travelpayouts one-way fares with duration_back: 0 and caps total upstream fetches well under 50 subrequests", async () => {
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
      fetchCount += 1;
      const rawUrl =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(rawUrl);
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
    // 10 discovery calls + <= 20 verify calls <= 30 external fetches (<50 Workers Free subrequest cap)
    expect(fetchCount).toBeLessThanOrEqual(30);
    expect(items.length).toBeGreaterThanOrEqual(15);
    expect(items.length).toBeLessThanOrEqual(20);
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
  });
});
