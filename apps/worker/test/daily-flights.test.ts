import { getDefaultDailyFlights, type DailyFlightsResponse } from "@split/shared";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { createDb } from "../src/db/client.js";
import {
  listDailyFlights,
  refreshDailyFlights,
  serpApiFlightSource,
  type FlightCandidate,
  type FlightSource,
} from "../src/flights/daily.js";
import { collectDailyFlights, formatDailyFlightsSyncSql } from "../src/flights/pipeline.js";
import { FLIGHTS_CRON, runScheduled } from "../src/maintenance.js";
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

function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A SerpApi `google_travel_explore` destination row, as the fake serves it. */
interface FakeDest {
  dest: string;
  price: number;
  out: string;
  /** Default: 5 days after `out`; `null` is a one-way fare. */
  back?: string | null;
  stops?: number;
  airline?: string;
  code?: string;
}

function exploreBody(dests: readonly FakeDest[]) {
  return {
    search_metadata: { status: "Success" },
    destinations: dests.map((d) => ({
      name: d.dest,
      flight_price: d.price,
      start_date: d.out,
      ...(d.back === null ? {} : { end_date: d.back ?? addDaysIso(d.out, 5) }),
      number_of_stops: d.stops ?? 0,
      airline: d.airline ?? "Tigerair Taiwan",
      airline_code: d.code ?? "IT",
      destination_airport: { code: d.dest },
    })),
  };
}

interface ExploreCall {
  key: string;
  departure: string;
  arrival: string | null;
  month: string | null;
  params: URLSearchParams;
}

const label = (c: ExploreCall) => `${c.departure}|${c.arrival ?? "-"}|${c.month ?? "-"}`;

/** Fakes SerpApi at the outermost `fetch` boundary; the handler answers each call with fares or a raw Response. */
function stubSerpApi(handler: (call: ExploreCall) => readonly FakeDest[] | Response) {
  const calls: ExploreCall[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    expect(`${url.origin}${url.pathname}`).toBe("https://serpapi.com/search.json");
    const call: ExploreCall = {
      key: url.searchParams.get("api_key") ?? "",
      departure: url.searchParams.get("departure_id") ?? "",
      arrival: url.searchParams.get("arrival_area_id"),
      month: url.searchParams.get("month"),
      params: url.searchParams,
    };
    calls.push(call);
    const answer = handler(call);
    return Promise.resolve(
      answer instanceof Response ? answer : Response.json(exploreBody(answer)),
    );
  });
  return calls;
}

/** A date inside Explore month `m` (Dec 2026 .. Apr 2027) for the 2026-11-16 run. */
const dateInMonth = (m: number) => `${m === 12 ? 2026 : 2027}-${String(m).padStart(2, "0")}-10`;
const OUT = "2026-12-05"; // inside the 2026-11-17..2027-05-16 window of the 2026-11-16 run
const tpeAsiaNrt = (c: ExploreCall) =>
  c.departure === "TPE" && c.arrival === null && c.month === null
    ? [{ dest: "NRT", price: 8000, out: OUT }]
    : [];
const exhausted = () =>
  Response.json({ error: "Your account has run out of searches." }, { status: 429 });

async function sync(keys: string | null = "k1", now = clock.now) {
  await runScheduled(
    FLIGHTS_CRON,
    { ...env, ...(keys === null ? {} : { SERPAPI_KEYS: keys }) },
    now,
  );
}

async function board(now = clock.now): Promise<DailyFlightsResponse> {
  clock.now = now;
  const res = await setupApp().request("https://split.test/api/v1/flights/daily", {}, env);
  expect(res.status).toBe(200);
  return res.json<DailyFlightsResponse>();
}

describe("SerpApi Explore daily sync through the Worker cron", () => {
  // The 08:00 Taipei run time; the board window is 2026-11-17 .. 2027-05-16.
  beforeEach(async () => {
    clock.now = Date.parse("2026-11-16T00:00:00Z");
    await env.DB.prepare("DELETE FROM daily_flights").run();
    await env.DB.prepare("DELETE FROM daily_flights_runs").run();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("runs the 8 daily Explore queries: TPE Asia, Europe, North America, Oceania, KHH and TSA Asia, and 2 TPE Asia months", async () => {
    const calls = stubSerpApi(() => []);
    await sync();

    expect(calls).toHaveLength(8);
    const [tpeMonthA, tpeMonthB] = calls.filter((c) => c.month !== null);
    expect(
      calls
        .filter((c) => c.month === null)
        .map(label)
        .sort(),
    ).toEqual([
      "KHH|-|-",
      "TPE|-|-",
      "TPE|/m/02j9z|-",
      "TPE|/m/059g4|-",
      "TPE|/m/05nrg|-",
      "TSA|-|-",
    ]);
    for (const c of [tpeMonthA, tpeMonthB]) {
      expect(c?.departure).toBe("TPE");
      expect(c?.arrival).toBeNull();
      // Dec 2026 .. Apr 2027: months inside the open 6-month Explore window after the current one.
      expect(["12", "1", "2", "3", "4"]).toContain(c?.month);
    }
    expect(tpeMonthA?.month).not.toBe(tpeMonthB?.month);
    for (const c of calls) {
      expect(c.params.get("engine")).toBe("google_travel_explore");
      expect(c.params.get("currency")).toBe("TWD");
      expect(c.params.get("hl")).toBe("en");
      expect(c.params.get("gl")).toBe("tw");
      expect(c.params.get("type")).toBe("1");
      expect(c.params.has("arrival_id")).toBe(false);
    }
    // Continents are `arrival_area_id` (arrival_id is a single airport or city).
    expect(calls.filter((c) => c.arrival !== null).map((c) => c.arrival)).toEqual([
      "/m/02j9z",
      "/m/059g4",
      "/m/05nrg",
    ]);
  });

  it("rotates the 2 target months from day to day", async () => {
    const monthsOn = async (now: number) => {
      const calls = stubSerpApi(() => []);
      await sync("k1", now);
      vi.unstubAllGlobals();
      return calls
        .filter((c) => c.month !== null)
        .map((c) => c.month)
        .sort();
    };
    const day1 = await monthsOn(clock.now);
    const day2 = await monthsOn(clock.now + 86_400_000);
    expect(day1).not.toEqual(day2);
  });

  it("admits every in-catalog round-trip fare from tomorrow to 6 months out under 3 stops, whatever its discount", async () => {
    stubSerpApi((c) =>
      c.departure === "TPE" && c.arrival === null && c.month === null
        ? [
            { dest: "NRT", price: 30000, out: OUT }, // far above the typical price: 0% off, still admitted
            { dest: "OKA", price: 3000, out: "2026-11-17" }, // tomorrow, inclusive
            { dest: "KIX", price: 6000, out: "2027-05-16", stops: 2 }, // last day, 2 stops
            { dest: "HND", price: 5000, out: "2026-11-16" }, // today
            { dest: "ICN", price: 5000, out: "2027-05-17" }, // past 6 months
            { dest: "FUK", price: 5000, out: OUT, stops: 3 }, // 3 stops
            { dest: "BKK", price: 5000, out: OUT, back: null }, // one-way
            { dest: "SIN", price: 5000, out: OUT, back: OUT }, // returns the day it leaves
            { dest: "CCU", price: 5000, out: OUT }, // not a Curated Destination
          ]
        : [],
    );
    await sync();

    const { items, isFallback } = await board();
    expect(isFallback).toBe(false);
    expect(items.map((i) => i.dest).sort()).toEqual(["KIX", "NRT", "OKA"]);
    const nrt = items.find((i) => i.dest === "NRT");
    expect(nrt).toMatchObject({ origin: "TPE", priceTwd: 30000, discountPct: 0 });
    expect(nrt?.inDate).toBe(addDaysIso(OUT, 5));
  });

  it("keeps the cheapest fare per origin, destination and departure date across queries", async () => {
    stubSerpApi((c) =>
      c.departure === "TPE" && c.arrival === null
        ? [{ dest: "NRT", price: c.month === null ? 9000 : 7000, out: OUT }]
        : [],
    );
    await sync();
    const nrt = (await board()).items.filter((i) => i.dest === "NRT");
    expect(nrt).toHaveLength(1);
    expect(nrt[0]?.priceTwd).toBe(7000);
  });

  it("serves one date per departure date: the month queries add more dates for the same route", async () => {
    stubSerpApi((c) =>
      c.departure === "TPE" && c.arrival === null
        ? [{ dest: "NRT", price: 9000, out: c.month === null ? OUT : dateInMonth(Number(c.month)) }]
        : [],
    );
    await sync();
    expect((await board()).items.filter((i) => i.dest === "NRT").length).toBeGreaterThanOrEqual(2);
  });

  it("covers every active origin and long-haul region in one board", async () => {
    stubSerpApi((c) => {
      if (c.arrival === "/m/02j9z") return [{ dest: "LHR", price: 25000, out: OUT }];
      if (c.arrival === "/m/059g4") return [{ dest: "LAX", price: 22000, out: OUT }];
      if (c.arrival === "/m/05nrg") return [{ dest: "SYD", price: 18000, out: OUT }];
      if (c.departure === "KHH") return [{ dest: "KIX", price: 6000, out: OUT }];
      if (c.departure === "TSA") return [{ dest: "HND", price: 7000, out: OUT }];
      return c.month === null ? [{ dest: "NRT", price: 8000, out: OUT }] : [];
    });
    await sync();
    const { items } = await board();
    expect(items.map((i) => `${i.origin}-${i.dest}`).sort()).toEqual([
      "KHH-KIX",
      "TPE-LAX",
      "TPE-LHR",
      "TPE-NRT",
      "TPE-SYD",
      "TSA-HND",
    ]);
    expect(items.find((i) => i.dest === "LHR")?.region).toBe("longhaul");
  });

  it("replaces yesterday's fares on a completed run, even when today has none", async () => {
    stubSerpApi((c) =>
      c.departure === "TPE" && c.arrival === null && c.month === null
        ? [{ dest: "NRT", price: 8000, out: OUT }]
        : [],
    );
    await sync();
    expect((await board()).items.map((i) => i.dest)).toEqual(["NRT"]);
    vi.unstubAllGlobals();

    stubSerpApi((c) => (c.departure === "KHH" ? [{ dest: "KIX", price: 6000, out: OUT }] : []));
    await sync("k1", clock.now + 86_400_000);
    expect((await board(clock.now)).items.map((i) => i.dest)).toEqual(["KIX"]);
    vi.unstubAllGlobals();

    stubSerpApi(() => []);
    await sync("k1", clock.now + 86_400_000);
    expect(await board(clock.now)).toMatchObject({ items: [], isFallback: false });
  });

  describe("airlines", () => {
    it("stores a single IATA airline_code as one carrier", async () => {
      stubSerpApi((c) =>
        c.departure === "KHH"
          ? [{ dest: "KIX", price: 6000, out: OUT, code: "MM", airline: "Peach" }]
          : [],
      );
      await sync();
      expect((await board()).items[0]?.airlines).toEqual(["MM"]);
    });

    it("parses airline_code multi into IATA codes for known carriers and keeps unknown names as fallback strings", async () => {
      stubSerpApi((c) =>
        c.departure === "KHH"
          ? [
              {
                dest: "KIX",
                price: 6000,
                out: OUT,
                code: "multi",
                airline: "Jetstar and Peach Aviation",
              },
              {
                dest: "OKA",
                price: 6500,
                out: OUT,
                code: "multi",
                airline: "Air India, EVA Air, and Etihad",
              },
            ]
          : [],
      );
      await sync();
      const byDest = new Map((await board()).items.map((i) => [i.dest, i.airlines]));
      expect(byDest.get("KIX")).toEqual(["JQ", "MM"]);
      expect(byDest.get("OKA")).toEqual(["Air India", "BR", "EY"]);
    });

    it("skips a fare that names no carrier, never storing multi", async () => {
      stubSerpApi((c) =>
        c.departure === "KHH"
          ? [{ dest: "KIX", price: 6000, out: OUT, code: "multi", airline: "" }]
          : [],
      );
      await sync();
      expect((await board()).items).toEqual([]);
    });
  });

  describe("multiple SerpApi keys (SERPAPI_KEYS)", () => {
    it("moves to the next key when one runs out of searches, finishes the run, and never logs a key", async () => {
      const logged: string[] = [];
      for (const level of ["info", "warn", "error", "log"] as const) {
        vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
          logged.push(args.map(String).join(" "));
        });
      }
      let k1Served = 0;
      const calls = stubSerpApi((c) => {
        if (c.key === "key-one-secret") {
          if (k1Served >= 2) return exhausted();
          k1Served += 1;
        }
        return c.departure === "KHH"
          ? [{ dest: "KIX", price: 6000, out: OUT }]
          : [{ dest: "NRT", price: 8000, out: OUT }];
      });
      await sync(" key-one-secret , key-two-secret ,");

      // 2 served by the first key, the third retried on the second, the rest never touch the first again.
      // (Later calls are Baseline requests on the spare key, see flight-baselines.test.ts.)
      expect(calls.slice(0, 9).map((c) => c.key)).toEqual([
        "key-one-secret",
        "key-one-secret",
        "key-one-secret",
        ...Array<string>(6).fill("key-two-secret"),
      ]);
      expect((await board()).items.length).toBeGreaterThan(0);
      expect(logged.length).toBeGreaterThan(0);
      expect(logged.join("\n")).not.toMatch(/key-(one|two)-secret/);
    });

    it("treats an invalid key (401) like an exhausted one", async () => {
      const calls = stubSerpApi((c) =>
        c.key === "bad"
          ? Response.json({ error: "Invalid API key." }, { status: 401 })
          : tpeAsiaNrt(c),
      );
      await sync("bad,good");
      expect(calls.filter((c) => c.key === "bad")).toHaveLength(1);
      expect((await board()).items.map((i) => i.dest)).toEqual(["NRT"]);
    });

    it("leaves the stored board alone when every key is exhausted, and serves curated fares when there is none", async () => {
      stubSerpApi(tpeAsiaNrt);
      await sync("k1");
      vi.unstubAllGlobals();
      expect((await board()).items.map((i) => i.dest)).toEqual(["NRT"]);

      const calls = stubSerpApi(() => exhausted());
      await sync("k1,k2", clock.now + 3_600_000);
      expect(calls.map((c) => c.key)).toEqual(["k1", "k2"]); // later queries do not retry spent keys
      expect((await board(clock.now)).items.map((i) => i.dest)).toEqual(["NRT"]);

      await env.DB.prepare("DELETE FROM daily_flights").run();
      await env.DB.prepare("DELETE FROM daily_flights_runs").run();
      expect((await board()).isFallback).toBe(true);
    });

    it("does nothing without SERPAPI_KEYS", async () => {
      const calls = stubSerpApi(() => []);
      await sync(null);
      await sync("");
      expect(calls).toHaveLength(0);
      expect((await board()).isFallback).toBe(true);
    });
  });

  it("never logs the API key when fetch itself rejects with an error echoing the URL", async () => {
    const logged: string[] = [];
    for (const level of ["info", "warn", "error", "log"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(" "));
      });
    }
    vi.stubGlobal("fetch", (input: RequestInfo | URL) =>
      Promise.reject(
        new TypeError(`fetch failed: ${input instanceof Request ? input.url : input.toString()}`),
      ),
    );
    await sync("key-secret-xyz");
    expect(logged.some((line) => line.includes("serpapi_query_failed"))).toBe(true);
    expect(logged.join("\n")).not.toContain("key-secret-xyz");
  });

  it("skips a failed query without failing the run", async () => {
    stubSerpApi((c) => {
      if (c.arrival === "/m/02j9z") return new Response("upstream down", { status: 503 });
      if (c.arrival === "/m/059g4")
        return Response.json({ error: "Google hasn't returned any results for this search." });
      return c.departure === "KHH" ? [{ dest: "KIX", price: 6000, out: OUT }] : [];
    });
    await sync();
    expect((await board()).items.map((i) => i.dest)).toEqual(["KIX"]);
  });

  it("serves a destination's fare from a malformed row's neighbours: bad rows are dropped one by one", async () => {
    stubSerpApi((c) =>
      c.departure === "KHH"
        ? Response.json({
            destinations: [
              { flight_price: "cheap", start_date: OUT },
              { ...exploreBody([{ dest: "KIX", price: 6000, out: OUT }]).destinations[0] },
              null,
            ],
          })
        : [],
    );
    await sync();
    expect((await board()).items.map((i) => i.dest)).toEqual(["KIX"]);
  });

  it("syncs again on every cron run, even right after an earlier completed sync", async () => {
    const calls = stubSerpApi(() => []);
    await sync();
    await sync("k1", clock.now + 3_600_000);
    expect(calls).toHaveLength(16);
  });

  it("serves a completed run's fares for 48 hours, then counts them as unavailable (curated fares)", async () => {
    stubSerpApi((c) =>
      c.departure === "KHH" ? [{ dest: "KIX", price: 6000, out: "2027-01-20" }] : [],
    );
    await sync();
    const db = createDb(env.DB);
    const at48h = clock.now + 48 * 3_600_000;
    expect((await listDailyFlights(db, at48h)).items.map((i) => i.dest)).toEqual(["KIX"]);
    const stale = await listDailyFlights(db, at48h + 1);
    expect(stale.isFallback).toBe(true);
    expect(stale.items.length).toBeGreaterThanOrEqual(15);
  });
});

describe("daily flights API", () => {
  beforeEach(async () => {
    clock.now = Date.parse("2026-11-16T00:00:00Z");
    await env.DB.prepare("DELETE FROM daily_flights").run();
    await env.DB.prepare("DELETE FROM daily_flights_runs").run();
  });

  const candidate = (
    id: string,
    outDate: string,
    overrides: Partial<FlightCandidate> = {},
  ): FlightCandidate => ({
    id,
    origin: "TPE",
    dest: "NRT",
    outDate,
    inDate: addDaysIso(outDate, 4),
    priceTwd: 5000,
    airlines: ["MM"],
    transfers: 0,
    ...overrides,
  });

  it("applies the tomorrow-to-6-months window to the response: curated fares and a cache that rolled past midnight", async () => {
    const app = setupApp();
    const get = async (now: number) => {
      clock.now = now;
      const res = await app.request("https://split.test/api/v1/flights/daily", {}, env);
      expect(res.status).toBe(200);
      return res.json<DailyFlightsResponse>();
    };
    const now = Date.parse("2026-11-16T00:00:00Z"); // window 2026-11-17..2027-05-16
    const fallback = await get(now);
    expect(fallback.isFallback).toBe(true);
    expect(fallback.items.length).toBeGreaterThan(0);
    for (const item of fallback.items) {
      expect(item.outDate >= "2026-11-17" && item.outDate <= "2027-05-16").toBe(true);
    }

    const source: FlightSource = {
      fetchCandidates: () =>
        Promise.resolve([
          candidate("a", "2026-11-17"),
          candidate("b", "2026-12-10", { dest: "KIX" }),
        ]),
    };
    await refreshDailyFlights(createDb(env.DB), source, now);
    expect((await get(now)).items.map((i) => i.outDate)).toEqual(["2026-11-17", "2026-12-10"]);
    const nextDay = await get(now + 86_400_000); // 11-17 is today now: no longer sellable
    expect(nextDay.items.map((i) => i.outDate)).toEqual(["2026-12-10"]);
    expect(nextDay.isFallback).toBe(false);
  });

  it("serves curated fallback deals when D1 has no digest", async () => {
    const res = await setupApp().request("https://split.test/api/v1/flights/daily", {}, env);
    const body = await res.json<DailyFlightsResponse>();
    expect(body.isFallback).toBe(true);
    expect(body.items.length).toBeGreaterThanOrEqual(15);
  });

  it("chunks digests of 20+ rows across consecutive days without primary-key collisions", async () => {
    const db = createDb(env.DB);
    const source: FlightSource = {
      fetchCandidates: (digestDate) =>
        Promise.resolve(
          getDefaultDailyFlights(digestDate).map((item, idx) =>
            candidate(`${digestDate}-${idx}`, item.outDate, {
              origin: item.origin,
              dest: item.dest,
              inDate: item.inDate,
              priceTwd: item.priceTwd,
              airlines: item.airlines,
              transfers: item.transfers,
            }),
          ),
        ),
    };
    const day1 = await refreshDailyFlights(db, source, clock.now);
    const day2 = await refreshDailyFlights(db, source, clock.now + 86_400_000);
    expect(day1.length).toBeGreaterThanOrEqual(15);
    expect(day2.length).toBe(day1.length);
  });

  it("GET /flights/go redirects to bilingual Trip.com URLs and rejects invalid params", async () => {
    const app = setupApp();

    const zhRes = await app.request(
      "https://split.test/api/v1/flights/go?origin=TPE&dest=NRT&outDate=2026-12-01&inDate=2026-12-06&lang=zh-TW",
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
      "https://split.test/api/v1/flights/go?origin=TSA&dest=HND&outDate=2026-12-05&inDate=2026-12-09&lang=en",
      {},
      env,
    );
    expect(enRes.status).toBe(302);
    const enLocation = enRes.headers.get("Location");
    expect(enLocation).toContain("https://www.trip.com/flights/showfarefirst");
    expect(enLocation).toContain("dairport=TSA");
    expect(enLocation).toContain("aairport=HND");
    expect(enLocation).toContain("locale=en-US");
    expect(enLocation).toContain("rdate=2026-12-09");

    const badRes = await app.request(
      "https://split.test/api/v1/flights/go?origin=https://evil.com&dest=NRT&outDate=2026-12-01&inDate=2026-12-06",
      {},
      env,
    );
    expect(badRes.status).toBe(400);
  });

  it("GET /flights/go requires a return date and an active origin", async () => {
    const app = setupApp();
    const go = (query: string) =>
      app.request(`https://split.test/api/v1/flights/go?${query}`, {}, env);
    expect((await go("origin=TPE&dest=NRT&outDate=2026-12-01&lang=en")).status).toBe(400);
    expect((await go("origin=TPE&dest=NRT&outDate=2026-12-01&inDate=&lang=en")).status).toBe(400);
    expect((await go("origin=TPE&dest=NRT&outDate=2026-12-05&inDate=2026-12-01")).status).toBe(400);
    expect((await go("origin=RMQ&dest=NRT&outDate=2026-12-01&inDate=2026-12-06")).status).toBe(400);
    expect((await go("origin=KHH&dest=NRT&outDate=2026-12-01&inDate=2026-12-06")).status).toBe(302);
  });
});

describe("manual sync SQL", () => {
  it("collectDailyFlights and formatDailyFlightsSyncSql generate valid D1 SQL, escaping quotes", async () => {
    const cronNow = Date.parse("2026-11-16T00:00:00Z");
    const stubbedFetch = vi.fn(() =>
      Promise.resolve(
        Response.json(
          exploreBody([
            { dest: "OKA", price: 4590, out: "2026-12-10", code: "MM", airline: "Peach" },
          ]),
        ),
      ),
    );
    const source = serpApiFlightSource({ SERPAPI_KEYS: "k1" }, stubbedFetch);

    const collected = await collectDailyFlights(source, cronNow);
    expect(collected.completed).toBe(true);
    expect(collected.upstreamCalls).toBe(8);
    expect(collected.items.map((i) => i.origin).sort()).toEqual(["KHH", "TPE", "TSA"]);
    const sql = formatDailyFlightsSyncSql(collected.rows, {
      digestDate: collected.digestDate,
      at: cronNow,
    });
    expect(sql).toContain("DELETE FROM daily_flights;");
    expect(sql).toContain("INSERT OR REPLACE INTO daily_flights_runs");

    await env.DB.exec("DELETE FROM daily_flights;");
    for (const stmt of sql.split(";\n").filter((s) => s.trim().length > 0)) {
      await env.DB.prepare(stmt).run();
    }
    expect((await listDailyFlights(createDb(env.DB), cronNow)).items).toHaveLength(3);

    expect(formatDailyFlightsSyncSql([])).toBe(
      "DELETE FROM daily_flights;\nDELETE FROM daily_flights_runs;\n",
    );
    const [row] = collected.rows;
    expect(row).toBeDefined();
    if (row) {
      expect(formatDailyFlightsSyncSql([{ ...row, id: "id-with'quote" }])).toContain(
        "'id-with''quote'",
      );
      expect(() => formatDailyFlightsSyncSql([{ ...row, priceTwd: Number.NaN }])).toThrow(
        /Invalid numeric SQL literal/,
      );
    }
  });
});
