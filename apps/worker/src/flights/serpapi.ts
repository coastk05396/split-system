import { parseExploreAirlines, type FlightOrigin } from "@split/shared/flights";
import { z } from "zod";
import type { FlightCandidate, FlightSource } from "./pipeline.js";

const SERPAPI_URL = "https://serpapi.com/search.json";
/** Google Knowledge Graph ids that scope an Explore query to a continent. */
const EUROPE = "/m/02j9z";
const NORTH_AMERICA = "/m/059g4";
const OCEANIA = "/m/05nrg";
const QUERY_TIMEOUT_MS = 20_000;
/** HTTP statuses that mean the active key is spent or refused: move to the next key. */
const KEY_REFUSED_STATUSES: ReadonlySet<number> = new Set([401, 403, 429]);
const KEY_REFUSED_MESSAGE = /run out of searches|out of searches|invalid api key|throughput/i;
/** Upcoming calendar months queried on top of the default viewport, within Explore's open 6 months. */
const MONTH_POOL_SIZE = 5;
const MONTH_QUERIES_PER_DAY = 2;

export type FetchFn = (
  input: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** One `google_travel_explore` request: where from, which continent, and optionally one calendar month (1-12). */
export interface ExploreQuery {
  origin: FlightOrigin;
  arrivalAreaId?: string;
  month?: number;
}

/**
 * The 8 daily Explore queries (ADR 0013): Asia (the default viewport, which includes the Middle East
 * hubs), Europe, North America and Oceania from `TPE`, Asia from `KHH` and `TSA`, and 2 rotating
 * upcoming months of Asia from `TPE` for more departure dates on popular short-haul routes.
 */
export function exploreQueryPlan(digestDate: string): ExploreQuery[] {
  const [year, month] = digestDate.split("-").map(Number) as [number, number];
  const dayIndex = Math.floor(Date.parse(`${digestDate}T00:00:00Z`) / 86_400_000);
  const first = (dayIndex * MONTH_QUERIES_PER_DAY) % MONTH_POOL_SIZE;
  const months = Array.from({ length: MONTH_QUERIES_PER_DAY }, (_, i) => {
    const offset = 1 + ((first + i) % MONTH_POOL_SIZE);
    return new Date(Date.UTC(year, month - 1 + offset, 1)).getUTCMonth() + 1;
  });
  return [
    { origin: "TPE" },
    { origin: "TPE", arrivalAreaId: EUROPE },
    { origin: "TPE", arrivalAreaId: NORTH_AMERICA },
    { origin: "TPE", arrivalAreaId: OCEANIA },
    { origin: "KHH" },
    { origin: "TSA" },
    ...months.map((m): ExploreQuery => ({ origin: "TPE", month: m })),
  ];
}

/** Splits the comma-separated `SERPAPI_KEYS` secret into its non-empty, trimmed keys. */
export function parseSerpApiKeys(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key !== "");
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
 * SerpApi requests over an ordered list of keys: a key answering 401, 403, 429 or an out-of-searches /
 * invalid-key error is skipped for the rest of the client's life and the same request is retried on the
 * next key. `get` resolves to the parsed body, or `null` when the request failed or every key is spent.
 * Keys never reach a log line.
 */
export function createSerpApiClient(keys: readonly string[], upstreamFetch: FetchFn) {
  let keyIndex = 0;
  let calls = 0;
  return {
    calls: () => calls,
    async get(params: Record<string, string>): Promise<unknown> {
      while (keyIndex < keys.length) {
        const url = new URL(SERPAPI_URL);
        for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
        url.searchParams.set("api_key", keys[keyIndex] ?? "");
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
            typeof body === "object" && body !== null && "error" in body
              ? String(body.error)
              : null;
          if (
            KEY_REFUSED_STATUSES.has(res.status) ||
            (message !== null && KEY_REFUSED_MESSAGE.test(message))
          ) {
            console.warn(
              JSON.stringify({ event: "serpapi_key_refused", status: res.status, keyIndex }),
            );
            keyIndex += 1;
            continue;
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
      }
      return null;
    },
  };
}

export type SerpApiClient = ReturnType<typeof createSerpApiClient>;

/**
 * Production source backed by SerpApi `google_travel_explore` (ADR 0013). Queries run one after
 * another so a spent key hands over to the next one deterministically. A query that fails is skipped.
 */
export function serpApiFlightSource(
  env: { SERPAPI_KEYS?: string },
  upstreamFetch: FetchFn = (input, init) => fetch(input, init),
): FlightSource {
  let upstreamCalls = 0;
  let answered = 0;

  return {
    upstreamCalls: () => upstreamCalls,
    answeredQueries: () => answered,

    async fetchCandidates(digestDate) {
      answered = 0;
      const client = createSerpApiClient(parseSerpApiKeys(env.SERPAPI_KEYS), upstreamFetch);
      const candidates: FlightCandidate[] = [];

      for (const query of exploreQueryPlan(digestDate)) {
        const parsed = exploreResponseSchema.safeParse(
          await client.get({
            engine: "google_travel_explore",
            departure_id: query.origin,
            type: "1",
            ...(query.arrivalAreaId === undefined ? {} : { arrival_area_id: query.arrivalAreaId }),
            ...(query.month === undefined ? {} : { month: String(query.month) }),
            currency: "TWD",
            hl: "en",
            gl: "tw",
          }),
        );
        if (!parsed.success) continue;
        answered += 1;
        for (const raw of parsed.data.destinations ?? []) {
          const row = exploreDestinationSchema.safeParse(raw);
          const dest = row.success ? row.data.destination_airport?.code.toUpperCase() : undefined;
          if (!row.success || dest === undefined) continue;
          candidates.push({
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
      }
      upstreamCalls = client.calls();
      return candidates;
    },
  };
}
