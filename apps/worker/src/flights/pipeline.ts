import {
  computeArrivalTimeHm,
  computeDealSignal,
  DESTINATION_CATALOG,
  FLIGHT_ORIGINS,
  FLIGHT_STOP_CLASSES,
  FLIGHT_TRIP_TYPES,
  getDestinationMeta,
  departureBounds,
  hasRedEyeLeg,
  isGhostFare,
  type DailyFlightItem,
  type DealTag,
  type FlightOrigin,
  type FlightStopClass,
  type FlightTripType,
} from "@split/shared/flights";
import { z } from "zod";

export interface DailyFlightRow {
  id: string;
  digestDate: string;
  origin: FlightOrigin;
  destination: string;
  tripType: FlightTripType;
  outDate: string;
  inDate: string | null;
  priceTwd: number;
  discountPct: number;
  tag: DealTag;
  airlinesJson: string;
  transfers: number;
  returnTransfers: number | null;
  isRedEye: number;
  outboundDep: string | null;
  inboundDep: string | null;
  createdAt: number;
}

export interface FlightCandidate {
  id: string;
  origin: FlightOrigin;
  dest: string;
  tripType: FlightTripType;
  outDate: string;
  inDate: string | null;
  priceTwd: number;
  airlines: string[];
  transfers: number;
  returnTransfers: number | null;
  outboundDep: string | null;
  inboundDep: string | null;
  outboundArr?: string | null;
  inboundArr?: string | null;
  digestDate?: string;
  /** Monthly route-median (or Stage 1 fallback) price for this route and trip type; null/absent means no Deal Signal. */
  dealBaselineTwd?: number | null;
}

export interface VerifiedFlightPrice {
  priceTwd: number | null;
  airlines?: string[];
  transfers?: number;
  returnTransfers?: number | null;
  outboundDep?: string | null;
  inboundDep?: string | null;
  outboundArr?: string | null;
  inboundArr?: string | null;
}

/** A month-matrix median (`null`: upstream answered with fewer than 3 prices) for one Route, departure month and stop class. */
export interface BaselineEntry {
  origin: FlightOrigin;
  dest: string;
  tripType: FlightTripType;
  /** First day of the departure month, `YYYY-MM-01`. */
  month: string;
  stopClass: FlightStopClass;
  baselineTwd: number | null;
}

/** Persists month-matrix baselines between daily runs; failed fetches are never stored. */
export interface BaselineCache {
  /** Entries fetched within `BASELINE_CACHE_TTL_MS` of `now`. */
  load(now: number): Promise<BaselineEntry[]>;
  save(entries: readonly BaselineEntry[], now: number): Promise<void>;
}

export interface FlightSource {
  fetchCandidates(digestDate: string, now?: number): Promise<FlightCandidate[]>;
  verifyCandidate?(candidate: FlightCandidate, now?: number): Promise<VerifiedFlightPrice | null>;
  /** Upstream requests made since the last `fetchCandidates` started, for the run summary. */
  upstreamCalls?(): number;
}

// ~70 broad discovery + ~135 per-route queries + baselines for the cheapest candidates + <= 230 verifications per run, all sequential: needs Workers Paid (ADR 0008/0010).
/** Board size ceiling per trip type: 230 fares at most, never padded (ADR 0010). */
export const TRIP_QUOTAS: Readonly<Record<FlightTripType, number>> = { rt: 225, ow: 5 };
/** A Route (origin airport × destination airport × trip type) carries at most this many dates on the board. */
export const MAX_DATES_PER_ROUTE = 3;
/** Baselines are fetched for this many of a Route's cheapest candidates, then the best discounts are kept. */
export const BASELINE_CANDIDATES_PER_ROUTE = 6;
/** The candidate count shrinks so a run's estimated upstream calls stay under this (Workers Paid allows 1,000). */
export const MAX_DAILY_UPSTREAM_CALLS = 800;
/** Verification makes one call per board fare, so the whole ceiling is reserved for it. */
const MAX_VERIFICATIONS = TRIP_QUOTAS.rt + TRIP_QUOTAS.ow;
/** Below this many Stage 1 candidates for a destination and trip type, there is no Deal Signal. */
const MIN_SIGNAL_CANDIDATES = 3;
const DISCOVERY_LIMIT = "100";
/** Main Taipei airport, the origin of the per-route long-haul and country-main queries. */
const TARGETED_ORIGIN: FlightOrigin = "TPE";
const LONGHAUL_AIRPORTS: readonly string[] = DESTINATION_CATALOG.filter(
  (d) => d.region === "longhaul",
).map((d) => d.airport);
/** The most popular Asian destinations, asked route by route from every main origin so cheap broad results cannot crowd them out. */
const POPULAR_DESTINATIONS: readonly string[] = [
  ...["NRT", "HND", "KIX", "FUK", "CTS", "OKA"],
  ...["ICN", "PUS", "CJU"],
  ...["BKK", "CNX", "SIN", "KUL", "HAN", "SGN", "DAD", "MNL", "DPS"],
  ...["HKG", "PVG"],
];

/** One per-route discovery query: every date in the window for a single origin and destination. */
interface RouteQuery {
  origin: FlightOrigin;
  dest: string;
}

/**
 * Per-route discovery (ADR 0010): long-haul airports and one main airport for every country not yet
 * covered, all from the main Taipei airport, then popular destinations from every main origin.
 */
function routeQueries(): RouteQuery[] {
  const queries: RouteQuery[] = [
    ...LONGHAUL_AIRPORTS.map((dest) => ({ origin: TARGETED_ORIGIN, dest })),
    ...POPULAR_DESTINATIONS.map((dest) => ({ origin: TARGETED_ORIGIN, dest })),
  ];
  const covered = new Set(queries.map((q) => getDestinationMeta(q.dest)?.countryCode));
  for (const d of DESTINATION_CATALOG) {
    if (covered.has(d.countryCode)) continue;
    covered.add(d.countryCode);
    queries.push({ origin: TARGETED_ORIGIN, dest: d.airport }); // first catalog airport = the country's main one
  }
  for (const origin of FLIGHT_ORIGINS) {
    if (origin === TARGETED_ORIGIN) continue;
    queries.push(...POPULAR_DESTINATIONS.map((dest) => ({ origin, dest })));
  }
  return queries;
}
const ROUTE_QUERIES = routeQueries();
/** A fetched month-matrix baseline is reused for 3 days (ADR 0009) to keep the cron's upstream calls down. */
export const BASELINE_CACHE_TTL_MS = 3 * 24 * 3_600_000;

function baselineKey(
  origin: string,
  dest: string,
  tripType: FlightTripType,
  month: string,
  stopClass: FlightStopClass,
) {
  return `${origin}-${dest}-${tripType}-${month}-${stopClass}`;
}

/** A fare with a connection on either leg is compared with connecting prices only. */
function stopClassOf(transfers: number, returnTransfers: number | null): FlightStopClass {
  return transfers === 0 && (returnTransfers ?? 0) === 0 ? "direct" : "connecting";
}

/** A fare with 3 or more stops on either leg is never shown. */
function hasTooManyStops(transfers: number, returnTransfers: number | null): boolean {
  return transfers >= 3 || (returnTransfers ?? 0) >= 3;
}

const MAX_FOUND_AT_AGE_MS = 48 * 3_600_000;
const TAIPEI_OFFSET_MS = 8 * 3_600_000;

const travelpayoutsItemSchema = z.object({
  origin: z.string(),
  origin_airport: z.string().optional().nullable(),
  destination: z.string(),
  destination_airport: z.string().optional().nullable(),
  airline: z.string().optional().default("CI"),
  departure_at: z.string().optional().nullable(),
  return_at: z.string().optional().nullable(),
  price: z.number().positive(),
  transfers: z.number().int().min(0).optional().default(0),
  return_transfers: z.number().int().min(0).optional().nullable(),
  duration: z.number().int().min(0).optional().nullable(),
  duration_to: z.number().int().min(0).optional().nullable(),
  duration_back: z.number().int().min(0).optional().nullable(),
  found_at: z.string().optional().nullable(),
});

type TravelpayoutsItem = z.infer<typeof travelpayoutsItemSchema>;

const travelpayoutsResponseSchema = z.object({
  success: z.boolean().optional(),
  data: z.array(travelpayoutsItemSchema).optional().default([]),
});

const monthMatrixItemSchema = z.object({
  value: z.number().positive(),
  depart_date: z.string().optional(),
  number_of_changes: z.number().int().min(0).optional(),
});

const monthMatrixResponseSchema = z.object({
  success: z.boolean().optional(),
  data: z.array(monthMatrixItemSchema).optional().default([]),
});

type FetchFn = (
  input: string | URL,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Current YYYY-MM-DD in Asia/Taipei (`UTC+8`). */
export function taipeiDate(now: number): string {
  return new Date(now + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}

function toFlightOrigin(code: string): FlightOrigin | null {
  const upper = code.toUpperCase();
  return (FLIGHT_ORIGINS as readonly string[]).includes(upper) ? (upper as FlightOrigin) : null;
}

function resolveOriginAirport(
  raw: Pick<TravelpayoutsItem, "origin" | "origin_airport">,
): FlightOrigin | null {
  if (raw.origin_airport) {
    const byAirport = toFlightOrigin(raw.origin_airport);
    if (byAirport) return byAirport;
  }
  return toFlightOrigin(raw.origin);
}

function resolveDestinationAirport(
  raw: Pick<TravelpayoutsItem, "destination" | "destination_airport">,
) {
  if (raw.destination_airport) {
    const byAirport = getDestinationMeta(raw.destination_airport);
    if (byAirport) return byAirport;
  }
  return getDestinationMeta(raw.destination);
}

function extractTimePart(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const match = iso.match(/T(\d{2}:\d{2})/);
  return match?.[1] ?? null;
}

function isAcceptableFoundAt(foundAt: string | null | undefined, referenceMs: number): boolean {
  if (!foundAt) return true;
  const foundMs = Date.parse(foundAt);
  return !Number.isNaN(foundMs) && referenceMs - foundMs <= MAX_FOUND_AT_AGE_MS;
}

function positiveDuration(minutes: number | null | undefined): number | null {
  return minutes !== null && minutes !== undefined && minutes > 0 ? minutes : null;
}

function addMonthsIso(iso: string, months: number): string {
  const [y, m, day] = iso.split("-").map(Number) as [number, number, number];
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  first.setUTCDate(Math.min(day, lastDay));
  return first.toISOString().slice(0, 10);
}

/** Departure window: 14 days to 6 months from the run date (inclusive), plus its calendar months. */
export function discoveryWindow(digestDate: string): {
  from: string;
  to: string;
  months: string[];
} {
  const { from, to } = departureBounds(digestDate);
  const months: string[] = [];
  for (let cursor = from.slice(0, 7); cursor <= to.slice(0, 7);) {
    months.push(cursor);
    cursor = addMonthsIso(`${cursor}-01`, 1).slice(0, 7);
  }
  return { from, to, months };
}

function median(sortedAsc: readonly number[]): number {
  const mid = Math.floor(sortedAsc.length / 2);
  const hi = sortedAsc[mid] ?? 0;
  return sortedAsc.length % 2 === 1 ? hi : Math.round(((sortedAsc[mid - 1] ?? hi) + hi) / 2);
}

function routeKey(c: Pick<FlightCandidate, "origin" | "dest" | "tripType">): string {
  return `${c.origin}-${c.dest}-${c.tripType}`;
}

/** The `perRoute` cheapest candidates of every Route, cheapest first. */
function cheapestPerRoute(pool: readonly FlightCandidate[], perRoute: number): FlightCandidate[] {
  const byRoute = new Map<string, FlightCandidate[]>();
  for (const c of pool) byRoute.set(routeKey(c), [...(byRoute.get(routeKey(c)) ?? []), c]);
  return [...byRoute.values()]
    .flatMap((list) =>
      list
        .sort((a, b) => a.priceTwd - b.priceTwd || a.outDate.localeCompare(b.outDate))
        .slice(0, perRoute),
    )
    .sort((a, b) => a.priceTwd - b.priceTwd || a.outDate.localeCompare(b.outDate));
}

/**
 * Picks the board (ADR 0010): only Good Deals (a Baseline and a Deal Signal above `normal`), ranked
 * by discount with price breaking ties, at most `MAX_DATES_PER_ROUTE` dates per Route and
 * `TRIP_QUOTAS` fares per trip type as a ceiling. A quiet day yields a smaller board, never padding.
 */
function selectBoard(pool: readonly FlightCandidate[]): FlightCandidate[] {
  const selected: FlightCandidate[] = [];
  for (const tripType of FLIGHT_TRIP_TYPES) {
    const perRoute = new Map<string, number>();
    const ranked = pool
      .filter((c) => c.tripType === tripType)
      .map((c) => ({ c, ...computeDealSignal(c.priceTwd, c.dealBaselineTwd ?? 0) }))
      .filter(({ tag }) => tag !== "normal")
      .sort(
        (a, b) =>
          b.discountPct - a.discountPct ||
          a.c.priceTwd - b.c.priceTwd ||
          a.c.outDate.localeCompare(b.c.outDate),
      );
    let kept = 0;
    for (const { c } of ranked) {
      if (kept >= TRIP_QUOTAS[tripType]) break;
      if ((perRoute.get(routeKey(c)) ?? 0) >= MAX_DATES_PER_ROUTE) continue;
      perRoute.set(routeKey(c), (perRoute.get(routeKey(c)) ?? 0) + 1);
      selected.push(c);
      kept += 1;
    }
  }
  return selected;
}

async function fetchTravelpayoutsJson<T>(
  fetchFn: FetchFn,
  token: string,
  endpoint: string,
  query: Record<string, string>,
  schema: z.ZodType<T>,
  logContext: { event: string; [key: string]: unknown },
): Promise<T | null> {
  // A cleared timer (not `AbortSignal.timeout`) so hundreds of calls per run leave no pending timeouts behind.
  const abort = new AbortController();
  const timer = setTimeout(() => {
    abort.abort();
  }, 8_000);
  try {
    const url = new URL(endpoint);
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v);
    }
    const res = await fetchFn(url.toString(), {
      headers: { "X-Access-Token": token },
      signal: abort.signal,
    });
    if (!res.ok) {
      console.warn(JSON.stringify({ ...logContext, status: res.status }));
      return null;
    }
    return schema.parse(await res.json());
  } catch (error) {
    console.warn(JSON.stringify({ ...logContext, error: String(error) }));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTravelpayoutsPrices(
  fetchFn: FetchFn,
  token: string,
  query: Record<string, string>,
  logContext: { event: string; [key: string]: unknown },
): Promise<TravelpayoutsItem[] | null> {
  const parsed = await fetchTravelpayoutsJson(
    fetchFn,
    token,
    "https://api.travelpayouts.com/aviasales/v3/prices_for_dates",
    query,
    travelpayoutsResponseSchema,
    logContext,
  );
  return parsed ? parsed.data : null;
}

/** Month-matrix prices with their number of changes; `null` when the call failed. */
async function fetchMonthMatrixPrices(
  fetchFn: FetchFn,
  token: string,
  query: Record<string, string>,
  logContext: { event: string; [key: string]: unknown },
): Promise<{ price: number; changes: number }[] | null> {
  const parsed = await fetchTravelpayoutsJson(
    fetchFn,
    token,
    "https://api.travelpayouts.com/v2/prices/month-matrix",
    query,
    monthMatrixResponseSchema,
    logContext,
  );
  if (parsed === null) return null;
  // HTTP 200 with `success: false` is an upstream failure, not "no prices": null so it is retried, never cached.
  if (parsed.success === false) {
    console.warn(JSON.stringify({ ...logContext, error: "success_false" }));
    return null;
  }
  return parsed.data.map((d) => ({
    price: Math.round(d.value),
    changes: d.number_of_changes ?? 0,
  }));
}

/**
 * Production source backed by Travelpayouts `v3/prices_for_dates` discovery + candidate verification.
 * Returns no candidates when `TRAVELPAYOUTS_TOKEN` is unset or upstream yields nothing so
 * `listDailyFlights` discloses fallback reference deals (`isFallback: true`) cleanly.
 */
export function productionFlightSource(
  env: { TRAVELPAYOUTS_TOKEN?: string },
  upstreamFetch: FetchFn = (input, init) => fetch(input, init),
  baselineCache?: BaselineCache,
): FlightSource {
  let upstreamCalls = 0;
  const fetchFn: FetchFn = (input, init) => {
    upstreamCalls += 1;
    return upstreamFetch(input, init);
  };
  return {
    upstreamCalls: () => upstreamCalls,

    async fetchCandidates(digestDate, now = Date.now()) {
      upstreamCalls = 0;
      const token = env.TRAVELPAYOUTS_TOKEN;
      if (!token) return [];

      const collected: FlightCandidate[] = [];
      const seenKeys = new Set<string>();
      const window = discoveryWindow(digestDate);

      const ingest = (data: readonly TravelpayoutsItem[], oneWay: boolean) => {
        for (const raw of data) {
          if (!isAcceptableFoundAt(raw.found_at, now)) continue;
          const parsedOrigin = resolveOriginAirport(raw);
          const meta = resolveDestinationAirport(raw);
          if (!parsedOrigin || !meta || !raw.departure_at) continue;

          const outDate = raw.departure_at.slice(0, 10);
          if (outDate < window.from || outDate > window.to) continue;
          const inDate = !oneWay && raw.return_at ? raw.return_at.slice(0, 10) : null;
          const tripType: FlightTripType = inDate ? "rt" : "ow";
          if (
            hasTooManyStops(raw.transfers, tripType === "rt" ? (raw.return_transfers ?? 0) : null)
          ) {
            continue;
          }
          const dedupeKey = `${parsedOrigin}-${meta.airport}-${tripType}-${outDate}`;
          if (seenKeys.has(dedupeKey)) continue;
          seenKeys.add(dedupeKey);

          collected.push({
            id: `${digestDate}-${dedupeKey.toLowerCase()}`,
            origin: parsedOrigin,
            dest: meta.airport,
            tripType,
            outDate,
            inDate,
            priceTwd: Math.round(raw.price),
            airlines: [raw.airline.toUpperCase()],
            transfers: raw.transfers,
            returnTransfers: tripType === "rt" ? (raw.return_transfers ?? 0) : null,
            outboundDep: extractTimePart(raw.departure_at),
            inboundDep: extractTimePart(raw.return_at),
            outboundArr: computeArrivalTimeHm(
              raw.departure_at,
              positiveDuration(raw.duration_to) ?? positiveDuration(raw.duration),
              meta.airport,
            ),
            inboundArr: computeArrivalTimeHm(raw.return_at, raw.duration_back, parsedOrigin),
            digestDate,
          });
        }
      };

      // Sequential on purpose: one upstream request at a time keeps us far below Travelpayouts' rate limit.
      for (const origin of FLIGHT_ORIGINS) {
        for (const oneWay of [false, true]) {
          for (const month of window.months) {
            const data = await fetchTravelpayoutsPrices(
              fetchFn,
              token,
              {
                origin,
                currency: "twd",
                departure_at: month,
                sorting: "price",
                limit: DISCOVERY_LIMIT,
                one_way: oneWay ? "true" : "false",
              },
              { event: "travelpayouts_fetch_failed", origin, oneWay, month },
            );
            if (data !== null) ingest(data, oneWay);
          }
        }
      }

      // Cheap short-haul fares fill the per-origin, per-month limit above, so long-haul routes, popular
      // destinations and every country's main airport are asked for explicitly: one round-trip query
      // per route across the whole departure window (ADR 0009, 0010). A failed query is just skipped.
      for (const { origin, dest } of ROUTE_QUERIES) {
        const data = await fetchTravelpayoutsPrices(
          fetchFn,
          token,
          {
            origin,
            destination: dest,
            currency: "twd",
            sorting: "price",
            limit: DISCOVERY_LIMIT,
            one_way: "false",
          },
          { event: "travelpayouts_targeted_fetch_failed", origin, dest },
        );
        if (data !== null) ingest(data, false);
      }

      if (collected.length === 0) return [];

      // Deal Signal baseline: Travelpayouts month-matrix median per (origin, dest, tripType, month, stop class),
      // falling back to the Stage 1 same-day pool median per destination, trip type and stop class.
      const stage1Prices = new Map<string, number[]>();
      for (const c of collected) {
        const key = `${c.dest}-${c.tripType}-${stopClassOf(c.transfers, c.returnTransfers)}`;
        stage1Prices.set(key, [...(stage1Prices.get(key) ?? []), c.priceTwd]);
      }

      const monthBaselines = new Map<string, number | null>();
      try {
        for (const e of (await baselineCache?.load(now)) ?? []) {
          monthBaselines.set(
            baselineKey(e.origin, e.dest, e.tripType, e.month, e.stopClass),
            e.baselineTwd,
          );
        }
      } catch (error) {
        console.warn(JSON.stringify({ event: "baseline_cache_load_failed", error: String(error) }));
      }

      // Baselines come before selection: the cheapest candidates of each Route get one, then the
      // best discounts win. One month-matrix call serves a Route's month; cached ones are free. The
      // shortlist shrinks until the run's estimated upstream calls fit the budget.
      const monthOf = (c: FlightCandidate) => `${c.outDate.slice(0, 7)}-01`;
      const uncachedCalls = (list: readonly FlightCandidate[]) =>
        new Set(
          list
            .filter(
              (c) =>
                !monthBaselines.has(
                  baselineKey(
                    c.origin,
                    c.dest,
                    c.tripType,
                    monthOf(c),
                    stopClassOf(c.transfers, c.returnTransfers),
                  ),
                ),
            )
            .map((c) => `${routeKey(c)}-${monthOf(c)}`),
        ).size;
      const baselineBudget = MAX_DAILY_UPSTREAM_CALLS - upstreamCalls - MAX_VERIFICATIONS;
      let perRoute = BASELINE_CANDIDATES_PER_ROUTE;
      let shortlist = cheapestPerRoute(collected, perRoute);
      while (perRoute > 1 && uncachedCalls(shortlist) > baselineBudget) {
        perRoute -= 1;
        shortlist = cheapestPerRoute(collected, perRoute);
      }
      let baselineCallsLeft = Math.max(0, baselineBudget);
      console.info(
        JSON.stringify({
          event: "flight_candidate_count",
          candidatesPerRoute: perRoute,
          shortlisted: shortlist.length,
          estimatedBaselineCalls: uncachedCalls(shortlist),
        }),
      );
      const fetchedBaselines: BaselineEntry[] = [];
      for (const c of shortlist) {
        const month = monthOf(c);
        const stopClass = stopClassOf(c.transfers, c.returnTransfers);
        if (monthBaselines.has(baselineKey(c.origin, c.dest, c.tripType, month, stopClass))) {
          continue;
        }
        if (baselineCallsLeft <= 0) continue; // out of budget: Stage 1 fallback only
        baselineCallsLeft -= 1;

        const prices = await fetchMonthMatrixPrices(
          fetchFn,
          token,
          {
            origin: c.origin,
            destination: c.dest,
            month,
            currency: "twd",
            limit: "100",
            show_to_affiliates: "true",
            one_way: c.tripType === "ow" ? "true" : "false",
          },
          {
            event: "travelpayouts_month_matrix_failed",
            origin: c.origin,
            dest: c.dest,
            tripType: c.tripType,
            month,
          },
        );
        // One answer carries both stop classes; each needs 3+ prices of its own for a Baseline.
        for (const cls of FLIGHT_STOP_CLASSES) {
          const classPrices = (prices ?? [])
            .filter((p) => (p.changes === 0) === (cls === "direct"))
            .map((p) => p.price)
            .sort((a, b) => a - b);
          const baselineTwd =
            classPrices.length >= MIN_SIGNAL_CANDIDATES ? median(classPrices) : null;
          monthBaselines.set(baselineKey(c.origin, c.dest, c.tripType, month, cls), baselineTwd);
          // A failed fetch (null) is retried next run, never cached as "no signal".
          if (prices !== null) {
            fetchedBaselines.push({
              origin: c.origin,
              dest: c.dest,
              tripType: c.tripType,
              month,
              stopClass: cls,
              baselineTwd,
            });
          }
        }
      }
      try {
        if (baselineCache && fetchedBaselines.length > 0) {
          await baselineCache.save(fetchedBaselines, now);
        }
      } catch (error) {
        console.warn(JSON.stringify({ event: "baseline_cache_save_failed", error: String(error) }));
      }

      return selectBoard(
        shortlist.map((c) => {
          const stopClass = stopClassOf(c.transfers, c.returnTransfers);
          const matrixBaseline =
            monthBaselines.get(baselineKey(c.origin, c.dest, c.tripType, monthOf(c), stopClass)) ??
            null;
          if (matrixBaseline !== null) {
            return { ...c, dealBaselineTwd: matrixBaseline };
          }
          const group = stage1Prices.get(`${c.dest}-${c.tripType}-${stopClass}`) ?? [];
          return {
            ...c,
            dealBaselineTwd:
              group.length >= MIN_SIGNAL_CANDIDATES
                ? median([...group].sort((a, b) => a - b))
                : null,
          };
        }),
      );
    },

    async verifyCandidate(candidate, now = Date.now()) {
      const token = env.TRAVELPAYOUTS_TOKEN;
      if (!token) return null;

      const query: Record<string, string> = {
        origin: candidate.origin,
        destination: candidate.dest,
        departure_at: candidate.outDate,
        one_way: candidate.tripType === "ow" ? "true" : "false",
        currency: "twd",
        sorting: "price",
        limit: "10",
      };
      if (candidate.tripType === "rt" && candidate.inDate) {
        query["return_at"] = candidate.inDate;
      }

      const data = await fetchTravelpayoutsPrices(fetchFn, token, query, {
        event: "travelpayouts_verify_failed",
        id: candidate.id,
      });
      if (data === null || data.length === 0) return null;

      const referenceMs = now;
      const requireDirect = candidate.transfers === 0 && (candidate.returnTransfers ?? 0) === 0;

      const matches = data.filter((raw) => {
        const rowOrigin = resolveOriginAirport(raw);
        const rowDest = resolveDestinationAirport(raw);
        if (rowOrigin !== candidate.origin || rowDest?.airport !== candidate.dest) {
          return false;
        }
        if (!raw.departure_at || raw.departure_at.slice(0, 10) !== candidate.outDate) {
          return false;
        }
        if (candidate.tripType === "rt") {
          const retDate = raw.return_at ? raw.return_at.slice(0, 10) : null;
          if (retDate !== candidate.inDate) return false;
        }
        if (requireDirect) {
          const retTransfers = candidate.tripType === "ow" ? 0 : (raw.return_transfers ?? 0);
          if (raw.transfers > 0 || retTransfers > 0) return false;
        }
        return isAcceptableFoundAt(raw.found_at, referenceMs);
      });
      if (matches.length === 0) return null;

      const sameAirline = matches.find(
        (raw) => raw.airline.toUpperCase() === candidate.airlines[0],
      );
      const best = sameAirline ?? [...matches].sort((a, b) => a.price - b.price)[0];
      if (!best) return null;

      return {
        priceTwd: Math.round(best.price),
        airlines: [best.airline.toUpperCase()],
        transfers: best.transfers,
        returnTransfers: candidate.tripType === "rt" ? (best.return_transfers ?? 0) : null,
        outboundDep: extractTimePart(best.departure_at) ?? candidate.outboundDep,
        inboundDep: extractTimePart(best.return_at) ?? candidate.inboundDep,
        outboundArr:
          computeArrivalTimeHm(
            best.departure_at,
            positiveDuration(best.duration_to) ?? positiveDuration(best.duration),
            candidate.dest,
          ) ??
          candidate.outboundArr ??
          null,
        inboundArr:
          computeArrivalTimeHm(best.return_at, best.duration_back, candidate.origin) ??
          candidate.inboundArr ??
          null,
      };
    },
  };
}

export interface CollectedDailyFlights {
  digestDate: string;
  candidates: number;
  droppedNull: number;
  droppedGhost: number;
  droppedStops: number;
  /** Below 15% under the Baseline, or no Baseline at all. */
  droppedNotDeal: number;
  /** Distinct countries with at least one Good Deal on the board. */
  countriesWithDeal: number;
  /** Upstream requests this run used (Workers Paid allows 1,000 subrequests per invocation). */
  upstreamCalls: number;
  rows: DailyFlightRow[];
  items: DailyFlightItem[];
}

/** Logs uniform summary metrics (no secrets/PII) for scheduled and manual flight syncs. */
export function logDailyFlightsSummary(event: string, collected: CollectedDailyFlights): void {
  console.info(
    JSON.stringify({
      event,
      digestDate: collected.digestDate,
      candidates: collected.candidates,
      droppedNull: collected.droppedNull,
      droppedGhost: collected.droppedGhost,
      droppedStops: collected.droppedStops,
      droppedNotDeal: collected.droppedNotDeal,
      countriesWithDeal: collected.countriesWithDeal,
      upstreamCalls: collected.upstreamCalls,
      persisted: collected.rows.length,
    }),
  );
}

function sqlLiteral(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid numeric SQL literal: ${String(value)}`);
    }
    return String(Math.trunc(value));
  }
  return `'${value.replaceAll("'", "''")}'`;
}

/** Formats atomic replace SQL statements for `wrangler d1 execute --file`. */
export function formatDailyFlightsSyncSql(rows: readonly DailyFlightRow[]): string {
  const lines = ["DELETE FROM daily_flights;"];
  for (const row of rows) {
    const values = [
      sqlLiteral(row.id),
      sqlLiteral(row.digestDate),
      sqlLiteral(row.origin),
      sqlLiteral(row.destination),
      sqlLiteral(row.tripType),
      sqlLiteral(row.outDate),
      sqlLiteral(row.inDate),
      sqlLiteral(row.priceTwd),
      sqlLiteral(row.discountPct),
      sqlLiteral(row.tag),
      sqlLiteral(row.airlinesJson),
      sqlLiteral(row.transfers),
      sqlLiteral(row.returnTransfers),
      sqlLiteral(row.isRedEye),
      sqlLiteral(row.outboundDep),
      sqlLiteral(row.inboundDep),
      sqlLiteral(row.createdAt),
    ].join(", ");
    lines.push(
      `INSERT INTO daily_flights (id, digest_date, origin, destination, trip_type, out_date, in_date, price_twd, discount_pct, tag, airlines_json, transfers, return_transfers, is_red_eye, outbound_dep, inbound_dep, created_at) VALUES (${values});`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Runs Stage 2 verification, drops ghost fares (`null` or >20% & >NT$800 jump), fares with 3+ stops
 * and fares that are not Good Deals at the verified price, and tags red-eye legs, without writing to D1.
 */
export async function collectVerifiedDailyFlights(
  source: FlightSource,
  now: number,
): Promise<CollectedDailyFlights> {
  const digestDate = taipeiDate(now);
  const candidates = await source.fetchCandidates(digestDate, now);
  const rows: DailyFlightRow[] = [];
  const items: DailyFlightItem[] = [];

  let droppedNull = 0;
  let droppedGhost = 0;
  let droppedStops = 0;
  let droppedNotDeal = 0;

  for (const candidate of candidates) {
    const meta = getDestinationMeta(candidate.dest);
    if (meta === null || candidate.priceTwd <= 0) continue;

    let finalPrice = candidate.priceTwd;
    let airlines = candidate.airlines;
    let transfers = candidate.transfers;
    let returnTransfers = candidate.returnTransfers;
    let outboundDep = candidate.outboundDep;
    let inboundDep = candidate.inboundDep;
    let outboundArr = candidate.outboundArr ?? null;
    let inboundArr = candidate.inboundArr ?? null;

    if (source.verifyCandidate !== undefined) {
      const verified = await source.verifyCandidate(candidate, now);
      if (verified === null) {
        droppedNull += 1;
        continue;
      }
      if (isGhostFare(candidate.priceTwd, verified.priceTwd)) {
        droppedGhost += 1;
        continue;
      }
      if (verified.priceTwd !== null) {
        finalPrice = Math.round(verified.priceTwd);
      }
      if (verified.airlines !== undefined && verified.airlines.length > 0) {
        airlines = verified.airlines;
      }
      if (verified.transfers !== undefined) transfers = verified.transfers;
      if (verified.returnTransfers !== undefined) returnTransfers = verified.returnTransfers;
      if (verified.outboundDep !== undefined) outboundDep = verified.outboundDep;
      if (verified.inboundDep !== undefined) inboundDep = verified.inboundDep;
      if (verified.outboundArr !== undefined) outboundArr = verified.outboundArr;
      if (verified.inboundArr !== undefined) inboundArr = verified.inboundArr;
    }

    // Only Good Deals reach the board, judged on the verified price and stops (ADR 0010).
    if (hasTooManyStops(transfers, returnTransfers)) {
      droppedStops += 1;
      continue;
    }
    const { discountPct, tag } = computeDealSignal(finalPrice, candidate.dealBaselineTwd ?? 0);
    if (tag === "normal") {
      droppedNotDeal += 1;
      continue;
    }
    const isRedEye = hasRedEyeLeg([outboundDep, inboundDep, outboundArr, inboundArr]);

    rows.push({
      id: candidate.id,
      digestDate,
      origin: candidate.origin,
      destination: meta.airport,
      tripType: candidate.tripType,
      outDate: candidate.outDate,
      inDate: candidate.inDate,
      priceTwd: finalPrice,
      discountPct,
      tag,
      airlinesJson: JSON.stringify(airlines),
      transfers,
      returnTransfers,
      isRedEye: isRedEye ? 1 : 0,
      outboundDep,
      inboundDep,
      createdAt: now,
    });

    items.push({
      id: candidate.id,
      origin: candidate.origin,
      dest: meta.airport,
      region: meta.region,
      tripType: candidate.tripType,
      outDate: candidate.outDate,
      inDate: candidate.inDate,
      priceTwd: finalPrice,
      discountPct,
      tag,
      airlines,
      transfers,
      returnTransfers,
      isRedEye,
      outboundDep,
      inboundDep,
    });
  }

  return {
    digestDate,
    candidates: candidates.length,
    droppedNull,
    droppedGhost,
    droppedStops,
    droppedNotDeal,
    countriesWithDeal: new Set(items.map((i) => getDestinationMeta(i.dest)?.countryCode)).size,
    upstreamCalls: source.upstreamCalls?.() ?? 0,
    rows,
    items,
  };
}
