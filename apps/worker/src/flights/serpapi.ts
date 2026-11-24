import { getDestinationMeta, parseExploreAirlines, type FlightOrigin } from "@split/shared/flights";
import { z } from "zod";
import type { FlightCandidate, FlightSource } from "./pipeline.js";

const SERPAPI_URL = "https://serpapi.com/search.json";
/** Google Knowledge Graph ids that scope an Explore query to a continent. */
const EUROPE = "/m/02j9z";
const NORTH_AMERICA = "/m/059g4";
const OCEANIA = "/m/05nrg";
/** West Asia (Turkey, the Gulf, Egypt, Jordan) as one Explore area, verified live (ADR 0014). */
const MIDDLE_EAST = "/m/04wsz";
/** Country Knowledge Graph ids (ADR 0014, 0016), verified live. */
const JAPAN = "/m/03_3d";
const SOUTH_KOREA = "/m/06qd3";
const CANADA = "/m/0d060g";
const QUERY_TIMEOUT_MS = 20_000;
/** HTTP statuses that mean a role's key is spent or refused: that role is skipped for the run. */
const KEY_REFUSED_STATUSES: ReadonlySet<number> = new Set([401, 403, 429]);
const KEY_REFUSED_MESSAGE = /run out of searches|out of searches|invalid api key|throughput/i;
/** Upcoming calendar months queried on top of the default viewport, within Explore's open 6 months. */
const MONTH_POOL_SIZE = 5;

export type FetchFn = (
  input: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Which Worker secret pays for a request (ADR 0014): roles never borrow each other's key. */
export type SerpApiRole = "baseline" | "short" | "long" | "long2";

export interface SerpApiKeys {
  SERPAPI_KEY_BASELINE?: string;
  SERPAPI_KEY_SHORT?: string;
  SERPAPI_KEY_LONG?: string;
  SERPAPI_KEY_LONG2?: string;
}

const ROLE_KEY_VARIABLE: Record<SerpApiRole, keyof SerpApiKeys> = {
  baseline: "SERPAPI_KEY_BASELINE",
  short: "SERPAPI_KEY_SHORT",
  long: "SERPAPI_KEY_LONG",
  long2: "SERPAPI_KEY_LONG2",
};

/** One `google_travel_explore` request: where from, which continent, and optionally one calendar month (1-12). */
export interface ExploreQuery {
  origin: FlightOrigin;
  arrivalAreaId?: string;
  month?: number;
}

/**
 * Europe, North America, Oceania, the Middle East and Canada are paid for by the long-haul key (the
 * long2 key's month queries name their role); everything else by the short-haul one.
 */
const LONG_HAUL_AREAS: ReadonlySet<string> = new Set([
  EUROPE,
  NORTH_AMERICA,
  OCEANIA,
  MIDDLE_EAST,
  CANADA,
]);
const exploreRole = (query: ExploreQuery): SerpApiRole =>
  query.arrivalAreaId !== undefined && LONG_HAUL_AREAS.has(query.arrivalAreaId) ? "long" : "short";

/**
 * The daily Explore queries whose answers do not depend on another (ADR 0013, 0014, 0016): Asia from
 * `TPE` and `KHH`, Japan from `TPE` and `KHH`, South Korea from `KHH` (short-haul key, 5 of its 8), and
 * Europe, North America, Oceania, the Middle East and Canada from `TPE` (long-haul key, 5 of its 8).
 * Songshan (`TSA`) is never queried. The month-scoped queries follow, once their paired answer is in.
 */
const BASE_QUERIES: readonly ExploreQuery[] = [
  { origin: "TPE" },
  { origin: "KHH" },
  { origin: "TPE", arrivalAreaId: JAPAN },
  { origin: "KHH", arrivalAreaId: JAPAN },
  { origin: "KHH", arrivalAreaId: SOUTH_KOREA },
  { origin: "TPE", arrivalAreaId: EUROPE },
  { origin: "TPE", arrivalAreaId: NORTH_AMERICA },
  { origin: "TPE", arrivalAreaId: OCEANIA },
  { origin: "TPE", arrivalAreaId: MIDDLE_EAST },
  { origin: "TPE", arrivalAreaId: CANADA },
];

/**
 * The upcoming calendar months (1-12) inside Explore's window, never the current one, ordered by how few
 * cities `fares` prices in each (ADR 0016, decision 6); a tie keeps the earlier month. A failed or empty
 * answer counts 0 everywhere, so the earliest months come first.
 */
function monthsByFewestCities(
  fares: readonly FlightCandidate[],
  digestDate: string,
): [number, number, ...number[]] {
  const [year, month] = digestDate.split("-").map(Number) as [number, number];
  // `YYYY-MM` of next month onwards (Date.UTC's month is 0-based, so `month + i` is i+1 months ahead).
  const upcoming = Array.from({ length: MONTH_POOL_SIZE }, (_, i) =>
    new Date(Date.UTC(year, month + i, 1)).toISOString().slice(0, 7),
  );
  const cities = new Map(upcoming.map((ym) => [ym, new Set<string>()]));
  for (const fare of fares) {
    cities.get(fare.outDate.slice(0, 7))?.add(getDestinationMeta(fare.dest)?.cityCode ?? fare.dest);
  }
  // `sort` is stable: equal counts keep `upcoming`'s chronological order.
  return upcoming
    .sort((a, b) => (cities.get(a)?.size ?? 0) - (cities.get(b)?.size ?? 0))
    .map((ym) => Number(ym.slice(5, 7))) as [number, number, ...number[]]; // MONTH_POOL_SIZE >= 2
}

const exploreDestinationSchema = z.object({
  flight_price: z.number().positive(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  number_of_stops: z.number().int().min(0).nullish(),
  airline: z.string().nullish(),
  airline_code: z.string().nullish(),
  destination_airport: z.object({ code: z.string() }).nullish(),
});

const exploreResponseSchema = z.object({ destinations: z.array(z.unknown()).optional() });

/**
 * SerpApi requests, each paid for by its role's own key (ADR 0014). A role whose key is missing or blank,
 * or that answered 401, 403, 429 or an out-of-searches / invalid-key error, is skipped for the rest of
 * the client's life with one log line (the role, never the key); the other roles carry on. `get`
 * resolves to the parsed body, or `null` when the request failed or its role is skipped.
 */
export function createSerpApiClient(env: SerpApiKeys, upstreamFetch: FetchFn) {
  const skipped = new Set<SerpApiRole>();
  let calls = 0;
  return {
    calls: () => calls,
    async get(role: SerpApiRole, params: Record<string, string>): Promise<unknown> {
      if (skipped.has(role)) return null;
      const key = env[ROLE_KEY_VARIABLE[role]]?.trim();
      if (key === undefined || key === "") {
        skipped.add(role);
        console.warn(
          JSON.stringify({ event: "serpapi_role_skipped", role, reason: "missing_key" }),
        );
        return null;
      }
      const url = new URL(SERPAPI_URL);
      for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
      url.searchParams.set("api_key", key);
      // A cleared timer (not `AbortSignal.timeout`) so a run leaves no pending timeouts behind.
      const abort = new AbortController();
      const timer = setTimeout(() => {
        abort.abort();
      }, QUERY_TIMEOUT_MS);
      calls += 1;
      try {
        const res = await upstreamFetch(url.toString(), { signal: abort.signal });
        const body: unknown = await res.json().catch(() => null);
        const message =
          typeof body === "object" && body !== null && "error" in body ? String(body.error) : null;
        if (
          KEY_REFUSED_STATUSES.has(res.status) ||
          (message !== null && KEY_REFUSED_MESSAGE.test(message))
        ) {
          skipped.add(role);
          console.warn(JSON.stringify({ event: "serpapi_key_refused", role, status: res.status }));
          return null;
        }
        if (!res.ok || message !== null) {
          console.warn(JSON.stringify({ event: "serpapi_query_failed", status: res.status }));
          return null;
        }
        return body;
      } catch (error) {
        // Only the error class: a fetch error message can echo the request URL, and with it `api_key`.
        console.warn(
          JSON.stringify({
            event: "serpapi_query_failed",
            error: error instanceof Error ? error.name : "Error",
          }),
        );
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export type SerpApiClient = ReturnType<typeof createSerpApiClient>;

/**
 * Production source backed by SerpApi `google_travel_explore` (ADR 0013, 0014, 0016). Short-haul queries
 * use the short key; Europe, North America, Oceania, the Middle East and Canada the long key, with the
 * long2 key paying for the second long-haul month queries. Queries run one after another
 * (a month-scoped one waits for its paired answer); a failed query, or one whose role is skipped, is left out.
 */
export function serpApiFlightSource(
  env: SerpApiKeys,
  upstreamFetch: FetchFn = (input, init) => fetch(input, init),
): FlightSource {
  let upstreamCalls = 0;
  let answered = 0;

  return {
    upstreamCalls: () => upstreamCalls,
    answeredQueries: () => answered,

    async fetchCandidates(digestDate) {
      answered = 0;
      const client = createSerpApiClient(env, upstreamFetch);
      const candidates: FlightCandidate[] = [];

      // One Explore query; its fares join `candidates`. `null` when it failed or its role is skipped.
      const run = async (
        query: ExploreQuery,
        role: SerpApiRole = exploreRole(query),
      ): Promise<FlightCandidate[] | null> => {
        const parsed = exploreResponseSchema.safeParse(
          await client.get(role, {
            engine: "google_travel_explore",
            departure_id: query.origin,
            type: "1",
            stops: "3", // at most 2 stops (ADR 0016, decision 1)
            ...(query.arrivalAreaId === undefined ? {} : { arrival_area_id: query.arrivalAreaId }),
            ...(query.month === undefined ? {} : { month: String(query.month) }),
            currency: "TWD",
            hl: "en",
            gl: "tw",
          }),
        );
        if (!parsed.success) return null;
        answered += 1;
        const fares: FlightCandidate[] = [];
        for (const raw of parsed.data.destinations ?? []) {
          const row = exploreDestinationSchema.safeParse(raw);
          const dest = row.success ? row.data.destination_airport?.code.toUpperCase() : undefined;
          if (!row.success || dest === undefined) continue;
          fares.push({
            id: `${digestDate}-${query.origin}-${dest}-${row.data.start_date}`.toLowerCase(),
            origin: query.origin,
            dest,
            outDate: row.data.start_date,
            inDate: row.data.end_date ?? null,
            priceTwd: Math.round(row.data.flight_price),
            airlines: parseExploreAirlines(row.data.airline_code, row.data.airline),
            transfers: row.data.number_of_stops ?? 0,
          });
        }
        candidates.push(...fares);
        return fares;
      };

      const answers = new Map<string, FlightCandidate[] | null>();
      for (const query of BASE_QUERIES) {
        answers.set(`${query.origin}|${query.arrivalAreaId ?? ""}`, await run(query));
      }
      // Each month query takes the months its paired unscoped answer covered least, and runs even when
      // that answer failed. TPE Korea reads the KHH Korea answer.
      const monthsOf = (key: string) => monthsByFewestCities(answers.get(key) ?? [], digestDate);
      const [asiaA, asiaB] = monthsOf("TPE|");
      await run({ origin: "TPE", month: asiaA });
      await run({ origin: "TPE", month: asiaB });
      await run({
        origin: "TPE",
        arrivalAreaId: SOUTH_KOREA,
        month: monthsOf(`KHH|${SOUTH_KOREA}`)[0],
      });
      // Long-haul: month 1 on the long key; month 2, and both Middle East months, on the long2 key.
      const longMonths = [EUROPE, NORTH_AMERICA, OCEANIA].map(
        (area) => [area, monthsOf(`TPE|${area}`)] as const,
      );
      for (const [area, [month1]] of longMonths) {
        await run({ origin: "TPE", arrivalAreaId: area, month: month1 });
      }
      for (const [area, [, month2]] of longMonths) {
        await run({ origin: "TPE", arrivalAreaId: area, month: month2 }, "long2");
      }
      for (const month of monthsOf(`TPE|${MIDDLE_EAST}`).slice(0, 2)) {
        await run({ origin: "TPE", arrivalAreaId: MIDDLE_EAST, month }, "long2");
      }
      upstreamCalls = client.calls();
      return candidates;
    },
  };
}
