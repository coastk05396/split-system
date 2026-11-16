import {
  computeArrivalTimeHm,
  computeDealSignal,
  FLIGHT_ORIGINS,
  getDestinationMeta,
  hasRedEyeLeg,
  isGhostFare,
  ONE_WAY_BASELINE_FACTOR,
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

// 5 origins * 2 trip types = 10 discovery calls + <=20 candidate checks = <=30 fetches (<50 Workers Free cap with D1).
const REGION_LIMITS: Readonly<Record<FlightRegion, number>> = {
  jp: 7,
  kr: 3,
  sea: 4,
  hkmo: 3,
  longhaul: 3,
};

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

function isFreshFoundAt(foundAt: string | null | undefined, referenceMs: number): boolean {
  if (!foundAt) return false;
  const foundMs = Date.parse(foundAt);
  return !Number.isNaN(foundMs) && referenceMs - foundMs <= MAX_FOUND_AT_AGE_MS;
}

function positiveDuration(minutes: number | null | undefined): number | null {
  return minutes !== null && minutes !== undefined && minutes > 0 ? minutes : null;
}

function balanceByRegion(candidates: readonly FlightCandidate[]): FlightCandidate[] {
  const counts: Record<FlightRegion, number> = {
    jp: 0,
    kr: 0,
    sea: 0,
    hkmo: 0,
    longhaul: 0,
  };
  const selected: FlightCandidate[] = [];
  const sorted = [...candidates].sort((a, b) => a.priceTwd - b.priceTwd);

  for (const item of sorted) {
    const meta = getDestinationMeta(item.dest);
    if (!meta) continue;
    if (counts[meta.region] >= REGION_LIMITS[meta.region]) continue;
    counts[meta.region] += 1;
    selected.push(item);
  }
  return selected;
}

async function fetchTravelpayoutsPrices(
  fetchFn: FetchFn,
  token: string,
  query: Record<string, string>,
  logContext: { event: string; [key: string]: unknown },
): Promise<TravelpayoutsItem[] | null> {
  try {
    const url = new URL("https://api.travelpayouts.com/aviasales/v3/prices_for_dates");
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
    const body = travelpayoutsResponseSchema.parse(await res.json());
    return body.data;
  } catch (error) {
    console.warn(JSON.stringify({ ...logContext, error: String(error) }));
    return null;
  }
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

      for (const origin of FLIGHT_ORIGINS) {
        for (const oneWay of [false, true]) {
          const data = await fetchTravelpayoutsPrices(
            fetchFn,
            token,
            {
              origin,
              currency: "twd",
              unique: "true",
              sorting: "price",
              limit: "30",
              one_way: oneWay ? "true" : "false",
            },
            { event: "travelpayouts_fetch_failed", origin, oneWay },
          );
          if (data === null) continue;

          for (const raw of data) {
            if (raw.found_at && !isFreshFoundAt(raw.found_at, now)) continue;
            const parsedOrigin = resolveOriginAirport(raw);
            const meta = resolveDestinationAirport(raw);
            if (!parsedOrigin || !meta || !raw.departure_at) continue;

            const outDate = raw.departure_at.slice(0, 10);
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

      if (collected.length === 0) return [];
      return balanceByRegion(collected);
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
        return isFreshFoundAt(raw.found_at, referenceMs);
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

function sqlLiteral(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(Math.trunc(value));
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
    const baseline =
      candidate.tripType === "ow"
        ? Math.round(meta.baselineTwd * ONE_WAY_BASELINE_FACTOR)
        : meta.baselineTwd;
    const { discountPct, tag } = computeDealSignal(finalPrice, baseline);

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
