import type { DailyFlightsResponse } from "@split/shared";
import { DESTINATION_CATALOG, getDestinationMeta } from "@split/shared";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import {
  CORE_BASELINE_ROUTES,
  fetchTypicalRanges,
  formatBaselineSql,
} from "../src/flights/baselines.js";
import { FLIGHTS_CRON, runScheduled } from "../src/maintenance.js";
import { silentReplyClient } from "../src/line/reply-client.js";
import type { RateSource } from "../src/rates/rate-source.js";
import { clock, fakeVerifier } from "./auth-harness.js";

const DAY = 86_400_000;
/** Inside the board window of the 2026-11-16 run and of one a month later. */
const OUT = "2027-01-20";
const BACK = "2027-01-25";

const noopRateSource: RateSource = {
  fetchRate: () => Promise.reject(new Error("unused in baseline tests")),
};

interface FareSpec {
  origin: string;
  dest: string;
  price: number;
}

interface FlightsCall {
  key: string;
  departure: string;
  arrival: string;
  outDate: string;
  returnDate: string;
  params: URLSearchParams;
}

/**
 * Fakes SerpApi at the `fetch` boundary: Explore answers `explore(departure)`, `google_flights`
 * answers `typical(departure, arrival)` (`null`: a failed request, `undefined`: no range in the body).
 */
function stubSerpApi(opts: {
  explore?: (departure: string) => FareSpec[];
  typical?: (departure: string, arrival: string) => [number, number] | null | undefined;
}) {
  const flightsCalls: FlightsCall[] = [];
  let exploreCalls = 0;
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const p = url.searchParams;
    if (p.get("engine") === "google_travel_explore") {
      exploreCalls += 1;
      const departure = p.get("departure_id") ?? "";
      const fares =
        p.get("arrival_id") === null && p.get("month") === null
          ? (opts.explore?.(departure) ?? [])
          : [];
      return Promise.resolve(
        Response.json({
          destinations: fares
            .filter((f) => f.origin === departure)
            .map((f) => ({
              flight_price: f.price,
              start_date: OUT,
              end_date: BACK,
              number_of_stops: 0,
              airline: "Peach",
              airline_code: "MM",
              destination_airport: { code: f.dest },
            })),
        }),
      );
    }
    expect(p.get("engine")).toBe("google_flights");
    flightsCalls.push({
      key: p.get("api_key") ?? "",
      departure: p.get("departure_id") ?? "",
      arrival: p.get("arrival_id") ?? "",
      outDate: p.get("outbound_date") ?? "",
      returnDate: p.get("return_date") ?? "",
      params: p,
    });
    const range = opts.typical?.(p.get("departure_id") ?? "", p.get("arrival_id") ?? "");
    if (range === null) return Promise.resolve(new Response("down", { status: 503 }));
    return Promise.resolve(
      Response.json({
        price_insights:
          range === undefined ? { price_level: "typical" } : { typical_price_range: range },
      }),
    );
  });
  return { flightsCalls, exploreCalls: () => exploreCalls };
}

async function stored() {
  const { results } = await env.DB.prepare(
    "SELECT origin, destination, typical_low_twd AS low, typical_high_twd AS high, fetched_at AS at FROM flight_baselines ORDER BY origin, destination",
  ).all<{ origin: string; destination: string; low: number; high: number; at: number }>();
  return results;
}

async function seed(origin: string, destination: string, high: number, fetchedAt: number) {
  await env.DB.prepare(
    "INSERT OR REPLACE INTO flight_baselines (origin, destination, typical_low_twd, typical_high_twd, fetched_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(origin, destination, Math.round(high / 2), high, fetchedAt)
    .run();
}

const sync = (keys: string, now = clock.now) =>
  runScheduled(FLIGHTS_CRON, { ...env, SERPAPI_KEYS: keys }, now);

async function board(now = clock.now): Promise<DailyFlightsResponse> {
  clock.now = now;
  const app = createApp({
    verifier: () => fakeVerifier,
    now: () => clock.now,
    rateSource: noopRateSource,
    lineReplyClient: () => silentReplyClient,
  });
  const res = await app.request("https://split.test/api/v1/flights/daily", {}, env);
  expect(res.status).toBe(200);
  return res.json<DailyFlightsResponse>();
}

const discountOf = (items: DailyFlightsResponse["items"], origin: string, dest: string) =>
  items.find((i) => i.origin === origin && i.dest === dest);

describe("typical-high Baselines", () => {
  beforeEach(async () => {
    clock.now = Date.parse("2026-11-16T00:00:00Z");
    await env.DB.prepare("DELETE FROM daily_flights").run();
    await env.DB.prepare("DELETE FROM daily_flights_runs").run();
    await env.DB.prepare("DELETE FROM flight_baselines").run();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("scores each fare against typicalHighTwd via (origin, destination), then (TPE, destination), then the static baseline", async () => {
    await seed("KHH", "KIX", 20_000, clock.now - DAY);
    await seed("TPE", "FUK", 12_000, clock.now - DAY);
    await seed("TPE", "OKA", 10_000, clock.now - DAY);
    await seed("KHH", "OKA", 99_999, clock.now - 31 * DAY); // expired: ignored, TPE-OKA applies
    const staticHnd = getDestinationMeta("HND")?.baselineTwd ?? 0;
    stubSerpApi({
      explore: () => [
        { origin: "KHH", dest: "KIX", price: 5_000 }, // own range: 75% off 20,000
        { origin: "KHH", dest: "FUK", price: 9_000 }, // no KHH range: TPE-FUK 12,000 -> 25%
        { origin: "KHH", dest: "OKA", price: 4_000 }, // expired own range: TPE-OKA 10,000 -> 60%
        { origin: "TSA", dest: "HND", price: staticHnd }, // nothing in D1: static baseline -> 0%
        { origin: "TPE", dest: "NRT", price: 30_000 }, // above any typical high
      ],
    });
    await sync("only-key");

    const { items } = await board();
    expect(discountOf(items, "KHH", "KIX")).toMatchObject({ discountPct: 75, tag: "steal" });
    expect(discountOf(items, "KHH", "FUK")).toMatchObject({ discountPct: 25, tag: "below_market" });
    expect(discountOf(items, "KHH", "OKA")).toMatchObject({ discountPct: 60, tag: "steal" });
    expect(discountOf(items, "TSA", "HND")).toMatchObject({ discountPct: 0, tag: "normal" });
    expect(discountOf(items, "TPE", "NRT")).toMatchObject({ discountPct: 0, tag: "normal" });
  });

  it("spends no Baseline requests with a single key: the daily quota goes to Explore", async () => {
    const { flightsCalls, exploreCalls } = stubSerpApi({
      explore: () => [{ origin: "TPE", dest: "NRT", price: 8_000 }],
      typical: () => [8_000, 16_000],
    });
    await sync("only-key");
    expect(exploreCalls()).toBe(8);
    expect(flightsCalls).toHaveLength(0);
    expect(await stored()).toEqual([]);
  });

  it("refreshes missing Baselines through google_flights when a spare key is configured, scoring the same run with them", async () => {
    const { flightsCalls } = stubSerpApi({
      explore: () => [{ origin: "TPE", dest: "NRT", price: 6_000 }],
      typical: () => [8_400, 15_500],
    });
    await sync("key-a,key-b");

    expect(flightsCalls).toHaveLength(1);
    const call = flightsCalls[0];
    expect(call).toMatchObject({ departure: "TPE", arrival: "NRT" });
    expect(call?.params.get("currency")).toBe("TWD");
    expect(call?.params.get("hl")).toBe("en");
    expect(call?.params.get("gl")).toBe("tw");
    // A round trip a month out: both dates are set and the return is after the departure.
    expect(call?.outDate > "2026-11-16" && (call?.returnDate ?? "") > (call?.outDate ?? "")).toBe(
      true,
    );
    expect(await stored()).toEqual([
      { origin: "TPE", destination: "NRT", low: 8_400, high: 15_500, at: clock.now },
    ]);
    // 6,000 against a typical high of 15,500: 61% off.
    expect(discountOf((await board()).items, "TPE", "NRT")).toMatchObject({
      discountPct: 61,
      tag: "steal",
    });
  });

  it("reuses a Baseline for 30 days, then refreshes it", async () => {
    const { flightsCalls } = stubSerpApi({
      explore: () => [{ origin: "TPE", dest: "NRT", price: 6_000 }],
      typical: () => [8_400, 15_500],
    });
    await sync("a,b");
    expect(flightsCalls).toHaveLength(1);

    await sync("a,b", clock.now + 29 * DAY + 23 * 3_600_000); // a day before the 30 days are up
    expect(flightsCalls).toHaveLength(1); // still fresh

    const later = clock.now + 30 * DAY + 1;
    vi.unstubAllGlobals();
    const second = stubSerpApi({
      explore: () => [{ origin: "TPE", dest: "NRT", price: 6_000 }],
      typical: () => [9_000, 18_000],
    });
    await sync("a,b", later);
    expect(second.flightsCalls).toHaveLength(1);
    expect(await stored()).toEqual([
      { origin: "TPE", destination: "NRT", low: 9_000, high: 18_000, at: later },
    ]);
  });

  it("never stores a failed or range-less answer, and asks again on the next run", async () => {
    const answers: ([number, number] | null | undefined)[] = [null, undefined];
    let n = 0;
    const { flightsCalls } = stubSerpApi({
      explore: () => [{ origin: "TPE", dest: "NRT", price: 6_000 }],
      typical: () => answers[n++],
    });
    await sync("a,b");
    expect(await stored()).toEqual([]);
    await sync("a,b", clock.now + DAY);
    expect(await stored()).toEqual([]);
    expect(flightsCalls).toHaveLength(2);
    // Scored against the static baseline meanwhile; the run itself still completed.
    expect((await board()).items.length).toBeGreaterThan(0);
  });

  it("bounds the refresh to 8 requests per spare key, Taipei routes first", async () => {
    const dests = ["NRT", "KIX", "FUK", "OKA", "CTS", "NGO", "ICN", "PUS", "CJU", "BKK"];
    const { flightsCalls } = stubSerpApi({
      explore: (departure) =>
        departure === "KHH"
          ? dests.map((dest) => ({ origin: "KHH", dest, price: 5_000 }))
          : dests.map((dest) => ({ origin: "TPE", dest, price: 5_000 })),
      typical: () => [6_000, 12_000],
    });
    await sync("a,b");
    expect(flightsCalls).toHaveLength(8);
    expect(flightsCalls.every((c) => c.departure === "TPE")).toBe(true);
  });
});

describe("Baseline seed", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("covers about 50-60 core routes, all from active origins to Curated Destinations", () => {
    expect(CORE_BASELINE_ROUTES.length).toBeGreaterThanOrEqual(50);
    expect(CORE_BASELINE_ROUTES.length).toBeLessThanOrEqual(60);
    const airports = new Set(DESTINATION_CATALOG.map((d) => d.airport));
    for (const r of CORE_BASELINE_ROUTES) {
      expect(["TPE", "KHH", "TSA"]).toContain(r.origin);
      expect(airports.has(r.dest)).toBe(true);
    }
    expect(new Set(CORE_BASELINE_ROUTES.map((r) => `${r.origin}-${r.dest}`)).size).toBe(
      CORE_BASELINE_ROUTES.length,
    );
  });

  it("fetches ranges with key rotation, skips failures, and writes SQL that D1 accepts and the daily sync reads", async () => {
    await env.DB.prepare("DELETE FROM flight_baselines").run();
    stubSerpApi({
      typical: (_d, arrival) =>
        arrival === "ICN" ? null : arrival === "KIX" ? undefined : [8_400, 15_500],
    });
    const now = Date.parse("2026-11-16T00:00:00Z");
    const routes = [
      { origin: "TPE" as const, dest: "NRT" },
      { origin: "TPE" as const, dest: "ICN" },
      { origin: "TPE" as const, dest: "KIX" },
      { origin: "KHH" as const, dest: "NRT" },
    ];
    const ranges = await fetchTypicalRanges({ SERPAPI_KEYS: "k1,k2" }, routes, now);
    expect(ranges).toEqual([
      { origin: "TPE", dest: "NRT", typicalLowTwd: 8_400, typicalHighTwd: 15_500 },
      { origin: "KHH", dest: "NRT", typicalLowTwd: 8_400, typicalHighTwd: 15_500 },
    ]);

    const sql = formatBaselineSql(ranges, now);
    expect(sql).toContain("INSERT OR REPLACE INTO flight_baselines");
    for (const stmt of sql.split(";\n").filter((s) => s.trim() !== "")) {
      await env.DB.prepare(stmt).run();
    }
    expect(await stored()).toHaveLength(2);
    expect(formatBaselineSql([], now)).toBe("");
  });
});
