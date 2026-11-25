import { getDefaultDailyFlights, type DailyFlightsResponse } from "@split/shared";
import { DESTINATION_CATALOG, getDestinationMeta } from "@split/shared/flights";
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
import type { SerpApiKeys } from "../src/flights/serpapi.js";
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
  engine: string;
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
      engine: url.searchParams.get("engine") ?? "",
      key: url.searchParams.get("api_key") ?? "",
      departure: url.searchParams.get("departure_id") ?? "",
      arrival: url.searchParams.get("arrival_area_id"),
      month: url.searchParams.get("month"),
      params: url.searchParams,
    };
    calls.push(call);
    // Baseline lookups (`google_flights`) get an answer without a range; they are not Explore queries.
    if (call.engine !== "google_travel_explore") return Promise.resolve(Response.json({}));
    const answer = handler(call);
    return Promise.resolve(
      answer instanceof Response ? answer : Response.json(exploreBody(answer)),
    );
  });
  return calls;
}

/** A date inside Explore month `m` (Dec 2026 .. Apr 2027) for the 2026-11-16 run. */
const dateInMonth = (m: number) => `${m === 12 ? 2026 : 2027}-${String(m).padStart(2, "0")}-10`;
/** An Explore answer pricing the listed airports in each month (11 is the run's own month, 5 is past Explore's window). */
const answerByMonth = (byMonth: Record<number, readonly string[]>): FakeDest[] =>
  Object.entries(byMonth).flatMap(([m, dests]) =>
    dests.map((dest) => ({
      dest,
      price: 10000,
      out: m === "11" ? "2026-11-25" : dateInMonth(Number(m)),
    })),
  );
const OUT = "2026-12-05"; // inside the 2026-11-17..2027-05-16 window of the 2026-11-16 run
const tpeAsiaNrt = (c: ExploreCall) =>
  c.departure === "TPE" && c.arrival === null && c.month === null
    ? [{ dest: "NRT", price: 8000, out: OUT }]
    : [];
const exhausted = () =>
  Response.json({ error: "Your account has run out of searches." }, { status: 429 });

/** The Explore roles' keys; the Baseline key is left out so these runs make no Baseline requests. */
const EXPLORE_KEYS: SerpApiKeys = {
  SERPAPI_KEY_SHORT: "short-key",
  SERPAPI_KEY_LONG: "long-key",
  SERPAPI_KEY_LONG2: "long2-key",
};
const ALL_KEYS: SerpApiKeys = { ...EXPLORE_KEYS, SERPAPI_KEY_BASELINE: "baseline-key" };

async function sync(keys: SerpApiKeys = EXPLORE_KEYS, now = clock.now) {
  await runScheduled(FLIGHTS_CRON, { ...env, ...keys }, now);
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

  it("sends exactly the 8 short-haul queries a day on the short key, at most 2 stops each and none from Songshan", async () => {
    const calls = stubSerpApi(() => []);
    await sync();

    // Every answer is empty, so every month query takes the earliest upcoming months: Dec, then Jan.
    expect(
      calls
        .filter((c) => c.key === "short-key")
        .map(label)
        .sort(),
    ).toEqual([
      "KHH|-|-",
      "KHH|/m/03_3d|-",
      "KHH|/m/06qd3|-",
      "TPE|-|-",
      "TPE|-|1",
      "TPE|-|12",
      "TPE|/m/03_3d|-",
      "TPE|/m/06qd3|12",
    ]);
    expect(calls.some((c) => c.departure === "TSA")).toBe(false);
    for (const c of calls) {
      expect(c.params.get("engine")).toBe("google_travel_explore");
      // The long-haul keys' stops are checked with their queries (long2's nonstop ones send 1).
      // A month query sends no `stops`: Explore answers `stops` with `month` with empty results.
      if (c.key === "short-key") expect(c.params.get("stops")).toBe(c.month === null ? "3" : null);
      expect(c.params.get("currency")).toBe("TWD");
      expect(c.params.get("hl")).toBe("en");
      expect(c.params.get("gl")).toBe("tw");
      expect(c.params.get("type")).toBe("1");
      expect(c.params.has("arrival_id")).toBe(false);
    }
  });

  it("gives every Southeast Asia and China/HK/Macau city 4 fares: TPE and KHH Asia, and TPE Asia on two months", async () => {
    const cities = DESTINATION_CATALOG.filter((d) => d.region === "sea" || d.region === "hkmo");
    const dates = new Map<string, string>();
    // Explore's Asia viewport (no area) prices every one of these cities, on a date of its own per query.
    stubSerpApi((c) => {
      if (c.arrival !== null) return [];
      const key = `${c.departure}|${c.month ?? "-"}`;
      const out =
        c.month === null
          ? `2026-12-${c.departure === "TPE" ? "01" : "02"}`
          : dateInMonth(Number(c.month));
      dates.set(key, out);
      return cities.map((d) => ({ dest: d.airport, price: 5000, out }));
    });
    await sync();

    const fares = new Map<string, number>();
    for (const item of (await board()).items) {
      const city = getDestinationMeta(item.dest)?.cityCode ?? item.dest;
      fares.set(city, (fares.get(city) ?? 0) + 1);
    }
    expect(dates.size).toBe(4);
    for (const d of cities) expect(fares.get(d.cityCode)).toBeGreaterThanOrEqual(4);
  });

  describe("month-scoped queries", () => {
    const KOREA = "/m/06qd3";
    const monthCall = (calls: ExploreCall[], area: string) =>
      calls.find((c) => c.arrival === area && c.month !== null);
    const tpeAsiaMonths = (calls: ExploreCall[]) =>
      calls
        .filter((c) => c.departure === "TPE" && c.arrival === null && c.month !== null)
        .map((c) => c.month);
    const tpeAsia = (c: ExploreCall) => c.departure === "TPE" && c.arrival === null;

    it("scopes TPE Asia to the upcoming month with the fewest cities in the unscoped TPE Asia answer, then the next fewest", async () => {
      const calls = stubSerpApi((c) =>
        tpeAsia(c) && c.month === null
          ? answerByMonth({
              11: [], // the run's own month: never chosen
              12: ["NRT", "KIX", "BKK"],
              1: ["NRT", "HND"], // two airports, one city (Tokyo)
              2: ["SIN", "HKG"],
              3: ["BKK", "SIN", "HKG"],
              4: ["KIX", "OKA", "ICN", "FUK"],
              // 5: none, but May is past Explore's 6-month window: never chosen
            })
          : [],
      );
      await sync();
      expect(tpeAsiaMonths(calls)).toEqual(["1", "2"]);
    });

    it("scopes TPE Korea to the month with the fewest cities in the KHH Korea answer", async () => {
      const calls = stubSerpApi((c) =>
        c.departure === "KHH" && c.arrival === KOREA
          ? answerByMonth({
              12: ["PUS", "CJU", "TAE"],
              1: ["PUS", "CJU"],
              2: ["PUS"],
              3: ["PUS", "CJU"],
              4: ["PUS", "CJU", "TAE"],
            })
          : [],
      );
      await sync();
      expect(monthCall(calls, KOREA)).toMatchObject({ departure: "TPE", month: "2" });
    });

    it("still sends the month queries on the earliest upcoming months when their paired answer fails", async () => {
      const down = () => new Response("down", { status: 503 });
      const calls = stubSerpApi((c) =>
        (tpeAsia(c) || (c.departure === "KHH" && c.arrival === KOREA)) && c.month === null
          ? down()
          : [],
      );
      await sync();
      expect(tpeAsiaMonths(calls)).toEqual(["12", "1"]);
      expect(monthCall(calls, KOREA)?.month).toBe("12");
    });

    it("puts Busan, Jeju and Daegu on the board with their TPE and KHH fares", async () => {
      stubSerpApi((c) => {
        if (c.arrival !== KOREA) return [];
        const price = c.departure === "KHH" ? 4000 : 6000;
        return ["PUS", "CJU", "TAE"].map((dest) => ({ dest, price, out: dateInMonth(12) }));
      });
      await sync();
      const fares = (await board()).items.map((i) => `${i.origin}-${i.dest}`).sort();
      expect(fares).toEqual(["KHH-CJU", "KHH-PUS", "KHH-TAE", "TPE-CJU", "TPE-PUS", "TPE-TAE"]);
    });

    it("merges month-scoped answers with unscoped ones: the cheapest fare per origin, destination and departure date wins", async () => {
      stubSerpApi((c) => {
        if (!tpeAsia(c)) return [];
        return c.month === null
          ? [
              { dest: "NRT", price: 9000, out: dateInMonth(12) },
              { dest: "KIX", price: 5000, out: dateInMonth(12) },
            ]
          : [
              { dest: "NRT", price: 7000, out: dateInMonth(12) }, // cheaper: replaces the unscoped fare
              { dest: "KIX", price: 8000, out: dateInMonth(12) }, // dearer: dropped
              { dest: "NRT", price: 9500, out: "2026-12-20" }, // another date: kept beside it
            ];
      });
      await sync();
      const fares = (await board()).items.map((i) => `${i.dest}:${i.outDate}:${i.priceTwd}`).sort();
      expect(fares).toEqual(["KIX:2026-12-10:5000", "NRT:2026-12-10:7000", "NRT:2026-12-20:9500"]);
    });
  });

  describe("long-haul queries on the long and long2 keys (ADR 0016, decisions 4 and 5)", () => {
    const EUROPE = "/m/02j9z";
    const NORTH_AMERICA = "/m/059g4";
    const OCEANIA = "/m/05nrg";
    const MIDDLE_EAST = "/m/04wsz";
    const CANADA = "/m/0d060g";
    const longCalls = (calls: ExploreCall[]) => calls.filter((c) => c.key === "long-key");
    const long2Calls = (calls: ExploreCall[]) => calls.filter((c) => c.key === "long2-key");
    const monthCall = (calls: ExploreCall[], area: string) =>
      calls.find((c) => c.arrival === area && c.month !== null);
    /** Europe's month with the fewest cities is Feb, North America's is Mar. */
    const answers = (c: ExploreCall) => {
      if (c.arrival === EUROPE && c.month === null)
        return answerByMonth({
          12: ["LHR", "CDG"],
          1: ["LHR", "CDG"],
          2: ["CDG"],
          3: ["LHR", "CDG"],
          4: ["LHR", "CDG"],
        });
      if (c.arrival === NORTH_AMERICA && c.month === null)
        return answerByMonth({
          12: ["LAX", "JFK"],
          1: ["LAX", "JFK"],
          2: ["LAX", "JFK"],
          3: ["JFK"],
          4: ["LAX", "JFK"],
        });
      return [];
    };

    it("sends exactly 8 requests a day on the long key with the listed parameters", async () => {
      const calls = stubSerpApi(answers);
      await sync();
      // Oceania's answer is empty, so its month 1 is the earliest upcoming month, December.
      expect(longCalls(calls).map(label).sort()).toEqual([
        `TPE|${EUROPE}|-`,
        `TPE|${EUROPE}|2`,
        `TPE|${MIDDLE_EAST}|-`,
        `TPE|${NORTH_AMERICA}|-`,
        `TPE|${NORTH_AMERICA}|3`,
        `TPE|${OCEANIA}|-`,
        `TPE|${OCEANIA}|12`,
        `TPE|${CANADA}|-`,
      ]);
      // long2's stops are checked below: its month queries send none, its nonstop queries 1.
      for (const c of longCalls(calls))
        expect(c.params.get("stops")).toBe(c.month === null ? "3" : null);
      for (const c of [...longCalls(calls), ...long2Calls(calls)]) {
        expect(c.params.get("engine")).toBe("google_travel_explore");
        expect(c.params.get("type")).toBe("1");
        expect(c.params.get("currency")).toBe("TWD");
        expect(c.params.get("hl")).toBe("en");
        expect(c.params.get("gl")).toBe("tw");
      }
    });

    it("sends month 2 of Europe, North America and Oceania and months 1 and 2 of the Middle East on the long2 key", async () => {
      const calls = stubSerpApi(answers);
      await sync();
      // Europe: Feb has the fewest cities, then Dec/Jan/Mar/Apr tie and the earliest wins. North
      // America: Mar, then Dec. Oceania and the Middle East answer nothing: Dec, then Jan.
      expect(
        long2Calls(calls)
          .filter((c) => c.month !== null && !c.params.has("stops"))
          .map(label)
          .sort(),
      ).toEqual([
        `TPE|${EUROPE}|12`,
        `TPE|${MIDDLE_EAST}|1`,
        `TPE|${MIDDLE_EAST}|12`,
        `TPE|${NORTH_AMERICA}|12`,
        `TPE|${OCEANIA}|1`,
      ]);
    });

    it("sends nonstop-only TPE North America, Europe and Oceania queries on the long2 key, 8 a day in total", async () => {
      const calls = stubSerpApi(answers);
      await sync();
      expect(long2Calls(calls)).toHaveLength(8);
      const nonstop = calls.filter((c) => c.params.get("stops") === "1");
      expect(nonstop.map((c) => `${c.key}|${label(c)}`).sort()).toEqual([
        `long2-key|TPE|${EUROPE}|-`,
        `long2-key|TPE|${NORTH_AMERICA}|-`,
        `long2-key|TPE|${OCEANIA}|-`,
      ]);
    });

    it("reaches every long-haul city with at least 3 queries, and Canada's with 4", async () => {
      const longhaul = DESTINATION_CATALOG.filter((d) => d.region === "longhaul");
      const AREA_SUBREGION: Record<string, string> = {
        [EUROPE]: "europe",
        [NORTH_AMERICA]: "north_america",
        [OCEANIA]: "oceania",
        [MIDDLE_EAST]: "middle_east_islands",
      };
      // Each area query prices every city of its area on a date of its own: the unscoped answer in
      // December (so its month queries pick January and February), Canada's on 3 December.
      stubSerpApi((c) => {
        const inArea =
          c.arrival === CANADA
            ? longhaul.filter((d) => d.countryCode === "CA")
            : longhaul.filter((d) => d.subRegion === AREA_SUBREGION[c.arrival ?? ""]);
        const out =
          c.month !== null
            ? dateInMonth(Number(c.month))
            : c.arrival === CANADA
              ? "2026-12-03"
              : "2026-12-01";
        return inArea.map((d) => ({ dest: d.airport, price: 20000, out }));
      });
      await sync();

      const fares = new Map<string, number>();
      for (const item of (await board()).items) {
        fares.set(item.dest, (fares.get(item.dest) ?? 0) + 1);
      }
      expect(longhaul.length).toBeGreaterThan(0);
      for (const d of longhaul) {
        expect([d.airport, fares.get(d.airport)]).toEqual([
          d.airport,
          d.countryCode === "CA" ? 4 : 3,
        ]);
      }
    });

    it("sends the same long-haul queries on every day of the week", async () => {
      const labelsOn = async (now: number) => {
        const calls = stubSerpApi(answers);
        await sync(EXPLORE_KEYS, now);
        vi.unstubAllGlobals();
        return [...longCalls(calls), ...long2Calls(calls)]
          .map((c) => `${c.key}|${label(c)}`)
          .sort();
      };
      const first = await labelsOn(clock.now);
      for (let day = 1; day < 7; day += 1) {
        expect(await labelsOn(clock.now + day * 86_400_000)).toEqual(first);
      }
      expect(first).toHaveLength(16);
    });

    it("breaks a tie on the fewest cities with the earlier month, and never picks the current month or one past Explore's window", async () => {
      const calls = stubSerpApi((c) =>
        c.arrival === EUROPE && c.month === null
          ? answerByMonth({
              11: [], // fewest of all, but the run's own month
              12: ["LHR"], // tied with Jan, and earlier
              1: ["CDG"],
              2: ["LHR", "CDG"],
              3: ["LHR", "CDG"],
              4: ["LHR", "CDG"],
              // 5: none, but past the window
            })
          : [],
      );
      await sync();
      expect(monthCall(calls, EUROPE)?.month).toBe("12");
    });

    it.each([
      ["fails", () => new Response("down", { status: 503 })],
      ["is empty", () => []],
    ])(
      "still sends a month query, on the earliest upcoming month, when its unscoped answer %s",
      async (_, answer) => {
        const calls = stubSerpApi((c) => (c.arrival === EUROPE ? answer() : []));
        await sync();
        expect(monthCall(calls, EUROPE)?.month).toBe("12");
        expect(longCalls(calls)).toHaveLength(8);
        expect(long2Calls(calls).find((c) => c.arrival === EUROPE)?.month).toBe("1");
      },
    );

    it("puts Istanbul and Dubai from one Middle East answer on the board", async () => {
      stubSerpApi((c) =>
        c.arrival === MIDDLE_EAST
          ? [
              { dest: "IST", price: 18000, out: OUT },
              { dest: "DXB", price: 16000, out: OUT },
            ]
          : [],
      );
      await sync();
      const { items } = await board();
      expect(items.map((i) => `${i.origin}-${i.dest}`).sort()).toEqual(["TPE-DXB", "TPE-IST"]);
      expect(items.every((i) => i.region === "longhaul")).toBe(true);
    });

    it("shows a city in both the unscoped and the month answer once per distinct departure date", async () => {
      stubSerpApi((c) => {
        if (c.arrival !== EUROPE) return [];
        return c.month === null
          ? [
              { dest: "CDG", price: 24000, out: dateInMonth(2) },
              { dest: "LHR", price: 30000, out: dateInMonth(12) },
            ]
          : [
              { dest: "CDG", price: 22000, out: dateInMonth(2) }, // same date, cheaper: replaces
              { dest: "CDG", price: 25000, out: "2027-02-20" }, // another date: kept beside it
            ];
      });
      await sync();
      const fares = (await board()).items.map((i) => `${i.dest}:${i.outDate}:${i.priceTwd}`).sort();
      expect(fares).toEqual([
        "CDG:2027-02-10:22000",
        "CDG:2027-02-20:25000",
        "LHR:2026-12-10:30000",
      ]);
    });

    describe("Nonstop Fares (ADR 0016, decision 7)", () => {
      const nonstopQuery = (c: ExploreCall) => c.params.get("stops") === "1";
      const fares = async () =>
        (await board()).items
          .map((i) => `${i.dest}:${i.outDate}:${i.priceTwd}:${String(i.transfers)}`)
          .sort();

      it("admits a nonstop fare at +19% over its city's cheapest fare that day and drops one at +21%", async () => {
        // New York is one city: JFK's 1-stop NT$20,000 is its cheapest, so EWR's nonstop fares count against it.
        stubSerpApi((c) => {
          if (c.arrival !== NORTH_AMERICA || c.month !== null) return [];
          return nonstopQuery(c)
            ? [
                { dest: "EWR", price: 23800, out: "2026-12-12" }, // +19%: admitted
                { dest: "EWR", price: 24200, out: "2026-12-14" }, // +21%: dropped
              ]
            : [{ dest: "JFK", price: 20000, out: OUT, stops: 1 }];
        });
        await sync();
        expect(await fares()).toEqual(["EWR:2026-12-12:23800:0", "JFK:2026-12-05:20000:1"]);
      });

      it("keeps a nonstop fare beside a cheaper connecting fare on the same date, scored on the same Baseline", async () => {
        await env.DB.prepare("DELETE FROM flight_baselines").run();
        await env.DB.prepare(
          "INSERT INTO flight_baselines (origin, destination, typical_low_twd, typical_high_twd, fetched_at) VALUES ('TPE','SEA',20000,40000,?)",
        )
          .bind(clock.now)
          .run();
        stubSerpApi((c) => {
          if (c.arrival !== NORTH_AMERICA || c.month !== null) return [];
          return nonstopQuery(c)
            ? [{ dest: "SEA", price: 22654, out: OUT }]
            : [{ dest: "SEA", price: 21924, out: OUT, stops: 1 }];
        });
        await sync();
        const { items } = await board();
        await env.DB.prepare("DELETE FROM flight_baselines").run();
        expect(
          items.map((i) => `${i.dest}:${i.outDate}:${i.priceTwd}:${String(i.transfers)}`).sort(),
        ).toEqual(["SEA:2026-12-05:21924:1", "SEA:2026-12-05:22654:0"]);
        // round((40000 - price) / 40000 * 100)
        expect(items.map((i) => i.discountPct).sort()).toEqual([43, 45]);
        expect(new Set(items.map((i) => i.id)).size).toBe(2);
      });

      it("shows a nonstop fare once when a connecting query already priced the same nonstop fare", async () => {
        stubSerpApi((c) =>
          c.arrival === EUROPE && c.month === null ? [{ dest: "LHR", price: 30000, out: OUT }] : [],
        );
        await sync();
        expect(await fares()).toEqual(["LHR:2026-12-05:30000:0"]);
      });
    });
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

  it("covers TPE, KHH and every long-haul region in one board", async () => {
    stubSerpApi((c) => {
      if (c.arrival === "/m/02j9z") return [{ dest: "LHR", price: 25000, out: OUT }];
      if (c.arrival === "/m/059g4") return [{ dest: "LAX", price: 22000, out: OUT }];
      if (c.arrival === "/m/05nrg") return [{ dest: "SYD", price: 18000, out: OUT }];
      if (c.departure === "KHH") return [{ dest: "KIX", price: 6000, out: OUT }];
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
    ]);
    expect(items.find((i) => i.dest === "LHR")?.region).toBe("longhaul");
  });

  it("puts fares to the Europe and Middle East expansion airports on the board", async () => {
    stubSerpApi((c) => {
      if (c.arrival === "/m/02j9z")
        return [
          { dest: "BCN", price: 24000, out: OUT },
          { dest: "ATH", price: 23000, out: OUT },
        ];
      return tpeAsiaNrt(c).length > 0
        ? [
            { dest: "DOH", price: 21000, out: OUT },
            { dest: "CAI", price: 20000, out: OUT },
            { dest: "AMM", price: 22000, out: OUT },
          ]
        : [];
    });
    await sync();
    const { items } = await board();
    expect(
      items
        .filter((i) => i.region === "longhaul")
        .map((i) => i.dest)
        .sort(),
    ).toEqual(["AMM", "ATH", "BCN", "CAI", "DOH"]);
  });

  it("puts the North America and Oceania expansion airports on the board as long-haul fares", async () => {
    stubSerpApi((c) => {
      if (c.arrival === "/m/059g4")
        return ["ATL", "BOS", "LAS", "YYZ", "CUN", "MEX"].map((dest) => ({
          dest,
          price: 20000,
          out: OUT,
        }));
      if (c.arrival === "/m/05nrg")
        return ["BNE", "ADL", "CBR", "WLG", "ZQN"].map((dest) => ({
          dest,
          price: 15000,
          out: OUT,
        }));
      return [];
    });
    await sync();
    const { items } = await board();
    expect(items.map((i) => i.dest).sort()).toEqual(
      ["ADL", "ATL", "BNE", "BOS", "CBR", "CUN", "LAS", "MEX", "WLG", "YYZ", "ZQN"].sort(),
    );
    expect(new Set(items.map((i) => i.region))).toEqual(new Set(["longhaul"]));
    // no Baseline, so no discount, but every fare is still served
    expect(items.every((i) => i.discountPct === 0)).toBe(true);
  });

  it("puts fares to the nonstop-catalog airports (#220) on the board as long-haul fares", async () => {
    const answers: Record<string, string[]> = {
      "/m/059g4": [
        ...["EWR", "KOA", "SLC", "AUS", "SAT", "MSP", "PHL", "BNA", "PIT", "FLL"],
        ...["MSY", "DTW", "TPA", "STL", "YOW", "YHZ", "YWG", "YEG"],
      ],
      "/m/02j9z": ["NAP", "KRK", "GLA", "HAM", "MLA"],
      "/m/05nrg": ["GUM", "ROR", "SPN"],
    };
    stubSerpApi((c) =>
      // only the unscoped area queries answer (never a nonstop-only one), so each airport has one fare
      c.month === null && c.arrival !== null && c.params.get("stops") !== "1"
        ? (answers[c.arrival] ?? []).map((dest) => ({ dest, price: 20000, out: OUT }))
        : [],
    );
    await sync();
    const { items } = await board();
    expect(items.map((i) => i.dest).sort()).toEqual(Object.values(answers).flat().sort());
    expect(new Set(items.map((i) => i.region))).toEqual(new Set(["longhaul"]));
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
    await sync(EXPLORE_KEYS, clock.now + 86_400_000);
    expect((await board(clock.now)).items.map((i) => i.dest)).toEqual(["KIX"]);
    vi.unstubAllGlobals();

    stubSerpApi(() => []);
    await sync(EXPLORE_KEYS, clock.now + 86_400_000);
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

  describe("one SerpApi key per role (ADR 0014)", () => {
    const SECRETS = /baseline-key|short-key|long-key|long2-key/;
    const captureLogs = () => {
      const logged: string[] = [];
      for (const level of ["info", "warn", "error", "log"] as const) {
        vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
          logged.push(args.map(String).join(" "));
        });
      }
      return logged;
    };
    const LONG_AREAS = ["/m/02j9z", "/m/059g4", "/m/05nrg", "/m/04wsz", "/m/0d060g"];
    /** Short-haul fares answer KIX from KHH; long-haul areas answer LHR from Europe only. */
    const bothRoles = (c: ExploreCall) =>
      c.arrival === "/m/02j9z"
        ? [{ dest: "LHR", price: 20000, out: OUT }]
        : c.departure === "KHH"
          ? [{ dest: "KIX", price: 6000, out: OUT }]
          : [];
    const dests = async () => (await board()).items.map((i) => i.dest).sort();

    it("sends each query with its own role's key: short-haul, long-haul and Baseline never borrow", async () => {
      const calls = stubSerpApi(bothRoles);
      await sync(ALL_KEYS);

      const explore = calls.filter((c) => c.engine === "google_travel_explore");
      expect(explore).toHaveLength(24); // 8 short + 8 long + 8 long2
      for (const c of explore) {
        expect(c.key).toMatch(
          LONG_AREAS.includes(c.arrival ?? "") ? /^long2?-key$/ : /^short-key$/,
        );
      }
      expect(explore.filter((c) => c.key === "long-key")).toHaveLength(8);
      expect(explore.filter((c) => c.key === "long2-key")).toHaveLength(8);
      expect(explore.filter((c) => c.key === "short-key")).toHaveLength(8);
      const baseline = calls.filter((c) => c.engine === "google_flights");
      expect(baseline.length).toBeGreaterThan(0);
      expect(baseline.every((c) => c.key === "baseline-key")).toBe(true);
      expect(await dests()).toEqual(["KIX", "LHR"]);
    });

    it("skips only the short-haul role when its key is refused, and replaces the board from what answered", async () => {
      stubSerpApi(bothRoles);
      await sync();
      expect(await dests()).toEqual(["KIX", "LHR"]);
      vi.unstubAllGlobals();

      const logged = captureLogs();
      const calls = stubSerpApi((c) => (c.key === "short-key" ? exhausted() : bothRoles(c)));
      await sync(EXPLORE_KEYS, clock.now + 3_600_000);

      expect(calls.filter((c) => c.key === "short-key")).toHaveLength(1); // not asked again
      expect(calls.filter((c) => c.key === "long-key")).toHaveLength(8);
      expect(await dests()).toEqual(["LHR"]);
      expect(logged.some((line) => line.includes("serpapi_key_refused"))).toBe(true);
      expect(logged.join("\n")).not.toMatch(SECRETS);
    });

    it.each([401, 403, 429])(
      "treats a %i answer as a refused key, skipping only that role",
      async (status) => {
        const calls = stubSerpApi((c) =>
          c.key === "long-key" ? Response.json({ error: "no" }, { status }) : bothRoles(c),
        );
        await sync();
        expect(calls.filter((c) => c.key === "long-key")).toHaveLength(1);
        expect(calls.filter((c) => c.key === "short-key")).toHaveLength(8);
        expect(calls.filter((c) => c.key === "long2-key")).toHaveLength(8);
        expect(await dests()).toEqual(["KIX", "LHR"]); // LHR from long2's Europe month query
      },
    );

    it("drops only long2's fares when its key is missing, logging the skipped role and no key", async () => {
      // short answers KIX, long answers LHR, long2 answers CDG.
      const byKey = (c: ExploreCall) =>
        c.key === "long2-key" ? [{ dest: "CDG", price: 22000, out: OUT }] : bothRoles(c);
      stubSerpApi(byKey);
      await sync();
      expect(await dests()).toEqual(["CDG", "KIX", "LHR"]);
      vi.unstubAllGlobals();

      const logged = captureLogs();
      const calls = stubSerpApi(byKey);
      await sync(
        { SERPAPI_KEY_SHORT: "short-key", SERPAPI_KEY_LONG: "long-key" },
        clock.now + 3_600_000,
      );
      expect(calls.filter((c) => c.key === "long-key")).toHaveLength(8);
      expect(calls.filter((c) => c.key === "short-key")).toHaveLength(8);
      expect(await dests()).toEqual(["KIX", "LHR"]);
      expect(
        logged.some((line) => line.includes("serpapi_role_skipped") && line.includes("long2")),
      ).toBe(true);
      expect(logged.join("\n")).not.toMatch(SECRETS);
      expect(logged.join("\n")).not.toContain("serpapi.com");
    });

    it.each([401, 429])("skips only the long2 role when its key answers %i", async (status) => {
      const calls = stubSerpApi((c) =>
        c.key === "long2-key" ? Response.json({ error: "no" }, { status }) : bothRoles(c),
      );
      await sync();
      expect(calls.filter((c) => c.key === "long2-key")).toHaveLength(1);
      expect(calls.filter((c) => c.key === "long-key")).toHaveLength(8);
      expect(await dests()).toEqual(["KIX", "LHR"]);
    });

    it("skips only a role whose key is missing or blank, logging the role and no key", async () => {
      const logged = captureLogs();
      const calls = stubSerpApi(bothRoles);
      await sync({ SERPAPI_KEY_SHORT: "  ", SERPAPI_KEY_LONG: "long-key" });

      expect(calls.every((c) => c.key === "long-key")).toBe(true);
      expect(calls).toHaveLength(8);
      expect(await dests()).toEqual(["LHR"]);
      expect(logged.some((line) => line.includes("serpapi_role_skipped"))).toBe(true);
      expect(logged.join("\n")).not.toMatch(SECRETS);
    });

    it("leaves the stored board alone when every role is refused, and serves curated fares when there is none", async () => {
      stubSerpApi(tpeAsiaNrt);
      await sync();
      vi.unstubAllGlobals();
      expect(await dests()).toEqual(["NRT"]);

      const calls = stubSerpApi(() => exhausted());
      await sync(EXPLORE_KEYS, clock.now + 3_600_000);
      expect(calls.map((c) => c.key)).toEqual(["short-key", "long-key", "long2-key"]); // one ask per role
      expect(await dests()).toEqual(["NRT"]);

      await env.DB.prepare("DELETE FROM daily_flights").run();
      await env.DB.prepare("DELETE FROM daily_flights_runs").run();
      expect((await board()).isFallback).toBe(true);
    });

    it("does nothing without any role key, and keeps the stored board", async () => {
      stubSerpApi(tpeAsiaNrt);
      await sync();
      vi.unstubAllGlobals();

      const calls = stubSerpApi(() => []);
      await sync({}, clock.now + 3_600_000);
      await sync({ SERPAPI_KEY_BASELINE: "baseline-key" }, clock.now + 3_600_000); // Baseline alone explores nothing
      expect(calls.filter((c) => c.engine === "google_travel_explore")).toHaveLength(0);
      expect(await dests()).toEqual(["NRT"]);
    });

    it("never logs any key when fetch itself rejects with an error echoing the URL", async () => {
      const logged = captureLogs();
      vi.stubGlobal("fetch", (input: RequestInfo | URL) =>
        Promise.reject(
          new TypeError(`fetch failed: ${input instanceof Request ? input.url : input.toString()}`),
        ),
      );
      await sync(ALL_KEYS);
      expect(logged.some((line) => line.includes("serpapi_query_failed"))).toBe(true);
      expect(logged.join("\n")).not.toMatch(SECRETS);
    });
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
    await sync(EXPLORE_KEYS, clock.now + 3_600_000);
    expect(calls).toHaveLength(48); // twice (8 short-haul + 8 long-haul + 8 long2)
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

  it("admits a TSA fare like any other, with no Deal Signal gate (Songshan is no longer queried)", async () => {
    const source: FlightSource = {
      fetchCandidates: () =>
        Promise.resolve([candidate("tsa", "2026-12-10", { origin: "TSA", dest: "HND" })]),
    };
    const collected = await collectDailyFlights(source, clock.now);
    expect(collected.items).toMatchObject([{ origin: "TSA", dest: "HND", tag: "normal" }]);
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
      { ...env, TRIP_COM_ALLIANCE_ID: "111", TRIP_COM_SID: "222", TRIP_COM_SUB3: "333" },
    );
    expect(zhRes.status).toBe(302);
    expect(zhRes.headers.get("Cache-Control")).toBe("no-store");
    const zhLocation = zhRes.headers.get("Location");
    const zhLocationUrl = new URL(zhLocation ?? "");
    expect(zhLocationUrl.origin).toBe("https://tw.trip.com");
    expect(zhLocationUrl.pathname).toBe("/flights/showfarefirst");
    expect(zhLocation).toContain("dcity=tpe");
    expect(zhLocation).toContain("acity=tyo");
    expect(zhLocation).toContain("aairport=NRT");
    expect(zhLocation).toContain("locale=zh-TW");
    expect(zhLocation).toContain("Allianceid=111");
    expect(zhLocation).toContain("SID=222");
    expect(zhLocation).toContain("trip_sub1=");
    expect(zhLocation).toContain("trip_sub3=333");

    const enRes = await app.request(
      "https://split.test/api/v1/flights/go?origin=TSA&dest=HND&outDate=2026-12-05&inDate=2026-12-09&lang=en",
      {},
      env,
    );
    expect(enRes.status).toBe(302);
    const enLocation = enRes.headers.get("Location");
    const enLocationUrl = new URL(enLocation ?? "");
    expect(enLocationUrl.origin).toBe("https://www.trip.com");
    expect(enLocationUrl.pathname).toBe("/flights/showfarefirst");
    expect(enLocation).toContain("dairport=TSA");
    expect(enLocation).toContain("aairport=HND");
    expect(enLocation).toContain("locale=en-US");
    expect(enLocation).toContain("rdate=2026-12-09");
    expect(new URL(enLocation ?? "").searchParams.get("nonstoponly")).toBe("off");

    // A Nonstop Fare's link opens Trip.com filtered to nonstop flights.
    const nonstopRes = await app.request(
      "https://split.test/api/v1/flights/go?origin=TPE&dest=SEA&outDate=2027-01-12&inDate=2027-01-19&lang=en&nonstopOnly=1",
      {},
      env,
    );
    expect(nonstopRes.status).toBe(302);
    const nonstopLocation = new URL(nonstopRes.headers.get("Location") ?? "");
    expect(nonstopLocation.origin).toBe("https://www.trip.com");
    expect(nonstopLocation.pathname).toBe("/flights/showfarefirst");
    expect(nonstopLocation.searchParams.get("nonstoponly")).toBe("on");

    const badRes = await app.request(
      "https://split.test/api/v1/flights/go?origin=https://evil.com&dest=NRT&outDate=2026-12-01&inDate=2026-12-06",
      {},
      env,
    );
    expect(badRes.status).toBe(400);
  });

  it("GET /flights/daily returns the public affiliate parameters, only what is configured", async () => {
    const app = setupApp();
    const url = "https://split.test/api/v1/flights/daily";
    const configured = await app.request(
      url,
      {},
      { ...env, TRIP_COM_ALLIANCE_ID: "111", TRIP_COM_SID: "222", TRIP_COM_SUB3: "333" },
    );
    expect((await configured.json<{ affiliate: unknown }>()).affiliate).toEqual({
      allianceId: "111",
      sid: "222",
      sub3: "333",
    });

    const bare = await app.request(url, {}, env);
    expect((await bare.json<{ affiliate: unknown }>()).affiliate).toEqual({});
  });

  it("GET /flights/go without Allianceid or SID carries no affiliate parameters, even with sub3", async () => {
    const res = await setupApp().request(
      "https://split.test/api/v1/flights/go?origin=TPE&dest=NRT&outDate=2026-12-01&inDate=2026-12-06",
      {},
      { ...env, TRIP_COM_ALLIANCE_ID: "111", TRIP_COM_SUB3: "333" },
    );
    const location = res.headers.get("Location") ?? "";
    expect(location).not.toMatch(/Allianceid|SID|trip_sub/);
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
    const source = serpApiFlightSource(EXPLORE_KEYS, stubbedFetch);

    const collected = await collectDailyFlights(source, cronNow);
    expect(collected.completed).toBe(true);
    expect(collected.upstreamCalls).toBe(24); // 8 short + 8 long + 8 long2
    expect(collected.items.map((i) => i.origin).sort()).toEqual(["KHH", "TPE"]);
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
    expect((await listDailyFlights(createDb(env.DB), cronNow)).items).toHaveLength(2);

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
