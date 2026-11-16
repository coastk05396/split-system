import {
  computeArrivalTimeHm,
  computeDealSignal,
  FLIGHT_ORIGINS,
  FLIGHT_REGIONS,
  FLIGHT_TRIP_TYPES,
  getDestinationMeta,
  departureBounds,
  hasRedEyeLeg,
  isGhostFare,
  type DailyFlightItem,
  type DealTag,
  type FlightOrigin,
  type FlightRegion,
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

export interface FlightSource {
  fetchCandidates(digestDate: string, now?: number): Promise<FlightCandidate[]>;
  verifyCandidate?(candidate: FlightCandidate, now?: number): Promise<VerifiedFlightPrice | null>;
}

// ~60-70 discovery calls + <=200 verifications per run, all sequential: needs Workers Paid (ADR 0008).
const TRIP_QUOTAS: Readonly<Record<FlightTripType, number>> = { rt: 150, ow: 50 };
const REGION_WEIGHTS: Readonly<Record<FlightRegion, number>> = {
  jp: 7,
  kr: 3,
  sea: 4,
  hkmo: 3,
  longhaul: 3,
};
const MAX_DATES_PER_ROUTE = 5;
/** Below this many Stage 1 candidates for a destination and trip type, there is no Deal Signal. */
const MIN_SIGNAL_CANDIDATES = 3;
const DISCOVERY_LIMIT = "100";

/** Splits `total` across regions by `REGION_WEIGHTS` (largest remainder, ties by region order). */
function splitQuota(total: number): Record<FlightRegion, number> {
  const weightSum = FLIGHT_REGIONS.reduce((sum, r) => sum + REGION_WEIGHTS[r], 0);
  const raw = FLIGHT_REGIONS.map((r) => (total * REGION_WEIGHTS[r]) / weightSum);
  const quota = Object.fromEntries(
    FLIGHT_REGIONS.map((r, i) => [r, Math.floor(raw[i] ?? 0)]),
  ) as Record<FlightRegion, number>;
  let spare = total - FLIGHT_REGIONS.reduce((sum, r) => sum + quota[r], 0);
  const byRemainder = FLIGHT_REGIONS.map((r, i) => ({ r, frac: (raw[i] ?? 0) % 1 })).sort(
    (a, b) => b.frac - a.frac,
  );
  for (const { r } of byRemainder) {
    if (spare <= 0) break;
    quota[r] += 1;
    spare -= 1;
  }
  return quota;
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

/**
 * Picks the board: per trip type, a regional quota filled cheapest-first but round-robin across
 * departure months (so every month is represented), with at most 5 dates per route.
 */
function selectBoard(pool: readonly FlightCandidate[]): FlightCandidate[] {
  const selected: FlightCandidate[] = [];
  for (const tripType of FLIGHT_TRIP_TYPES) {
    const left = splitQuota(TRIP_QUOTAS[tripType]);
    const perRoute = new Map<string, number>();
    const byMonth = new Map<string, FlightCandidate[]>();
    for (const c of pool
      .filter((x) => x.tripType === tripType)
      .sort((a, b) => a.priceTwd - b.priceTwd)) {
      const month = c.outDate.slice(0, 7);
      byMonth.set(month, [...(byMonth.get(month) ?? []), c]);
    }
    const queues = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, q]) => q);

    for (let progressed = true; progressed;) {
      progressed = false;
      for (const queue of queues) {
        for (let c = queue.shift(); c !== undefined; c = queue.shift()) {
          const region = getDestinationMeta(c.dest)?.region;
          const route = `${c.origin}-${c.dest}`;
          if (region === undefined || left[region] <= 0) continue;
          if ((perRoute.get(route) ?? 0) >= MAX_DATES_PER_ROUTE) continue;
          left[region] -= 1;
          perRoute.set(route, (perRoute.get(route) ?? 0) + 1);
          selected.push(c);
          progressed = true;
          break;
        }
      }
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
  try {
    const url = new URL(endpoint);
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v);
    }
    const res = await fetchFn(url.toString(), {
      headers: { "X-Access-Token": token },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      console.warn(JSON.stringify({ ...logContext, status: res.status }));
      return null;
    }
    return schema.parse(await res.json());
  } catch (error) {
    console.warn(JSON.stringify({ ...logContext, error: String(error) }));
    return null;
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

async function fetchMonthMatrixPrices(
  fetchFn: FetchFn,
  token: string,
  query: Record<string, string>,
  logContext: { event: string; [key: string]: unknown },
): Promise<number[] | null> {
  const parsed = await fetchTravelpayoutsJson(
    fetchFn,
    token,
    "https://api.travelpayouts.com/v2/prices/month-matrix",
    query,
    monthMatrixResponseSchema,
    logContext,
  );
  return parsed ? parsed.data.map((d) => Math.round(d.value)) : null;
}

/**
 * Production source backed by Travelpayouts `v3/prices_for_dates` discovery + candidate verification.
 * Returns no candidates when `TRAVELPAYOUTS_TOKEN` is unset or upstream yields nothing so
 * `listDailyFlights` discloses fallback reference deals (`isFallback: true`) cleanly.
 */
export function productionFlightSource(
  env: { TRAVELPAYOUTS_TOKEN?: string },
  fetchFn: FetchFn = (input, init) => fetch(input, init),
): FlightSource {
  return {
    async fetchCandidates(digestDate, now = Date.now()) {
      const token = env.TRAVELPAYOUTS_TOKEN;
      if (!token) return [];

      const collected: FlightCandidate[] = [];
      const seenKeys = new Set<string>();
      const window = discoveryWindow(digestDate);

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
            if (data === null) continue;

            for (const raw of data) {
              if (!isAcceptableFoundAt(raw.found_at, now)) continue;
              const parsedOrigin = resolveOriginAirport(raw);
              const meta = resolveDestinationAirport(raw);
              if (!parsedOrigin || !meta || !raw.departure_at) continue;

              const outDate = raw.departure_at.slice(0, 10);
              if (outDate < window.from || outDate > window.to) continue;
              const inDate = !oneWay && raw.return_at ? raw.return_at.slice(0, 10) : null;
              const tripType: FlightTripType = inDate ? "rt" : "ow";
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
          }
        }
      }

      if (collected.length === 0) return [];

      // Deal Signal baseline: Travelpayouts month-matrix median per (origin, dest, tripType, month),
      // falling back to the Stage 1 same-day pool median per destination and trip type.
      const stage1Prices = new Map<string, number[]>();
      for (const c of collected) {
        const key = `${c.dest}-${c.tripType}`;
        stage1Prices.set(key, [...(stage1Prices.get(key) ?? []), c.priceTwd]);
      }

      const selected = selectBoard(collected);
      const monthBaselines = new Map<string, number | null>();
      for (const c of selected) {
        const month = `${c.outDate.slice(0, 7)}-01`;
        const matrixKey = `${c.origin}-${c.dest}-${c.tripType}-${month}`;
        if (monthBaselines.has(matrixKey)) continue;

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
        monthBaselines.set(
          matrixKey,
          prices !== null && prices.length >= MIN_SIGNAL_CANDIDATES
            ? median([...prices].sort((a, b) => a - b))
            : null,
        );
      }

      return selected.map((c) => {
        const matrixKey = `${c.origin}-${c.dest}-${c.tripType}-${c.outDate.slice(0, 7)}-01`;
        const matrixBaseline = monthBaselines.get(matrixKey) ?? null;
        if (matrixBaseline !== null) {
          return { ...c, dealBaselineTwd: matrixBaseline };
        }
        const group = stage1Prices.get(`${c.dest}-${c.tripType}`) ?? [];
        return {
          ...c,
          dealBaselineTwd:
            group.length >= MIN_SIGNAL_CANDIDATES ? median([...group].sort((a, b) => a - b)) : null,
        };
      });
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
 * Runs Stage 2 verification, drops ghost fares (`null` or >20% & >NT$800 jump),
 * retains and tags red-eye legs, and scores Deal Signals without writing to D1.
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

    const isRedEye = hasRedEyeLeg([outboundDep, inboundDep, outboundArr, inboundArr]);
    const { discountPct, tag } = computeDealSignal(finalPrice, candidate.dealBaselineTwd ?? 0);

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
    rows,
    items,
  };
}
