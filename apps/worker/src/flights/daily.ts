import {
  computeArrivalTimeHm,
  computeDealSignal,
  FLIGHT_ORIGINS,
  getDefaultDailyFlights,
  getDestinationMeta,
  hasRedEyeLeg,
  isGhostFare,
  ONE_WAY_BASELINE_FACTOR,
  type DailyFlightItem,
  type DailyFlightsResponse,
  type FlightOrigin,
  type FlightRegion,
  type FlightTripType,
} from "@split/shared";
import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { dailyFlights } from "../db/schema.js";
import type { Bindings } from "../env.js";

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

// 5 origins * 2 trip types = 10 discovery calls + <=20 candidate checks = <=30 fetches (<50 Workers Free cap with D1/rates).
const REGION_LIMITS: Readonly<Record<FlightRegion, number>> = {
  jp: 7,
  kr: 3,
  sea: 4,
  hkmo: 3,
  longhaul: 3,
};

const D1_INSERT_CHUNK_SIZE = 5;
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

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

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

function parseAirlinesJson(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (Array.isArray(parsed)) {
      const codes = parsed.filter((x): x is string => typeof x === "string" && x.length > 0);
      if (codes.length > 0) return codes;
    }
  } catch (error) {
    console.warn(JSON.stringify({ event: "airlines_json_parse_failed", error: String(error) }));
  }
  return ["CI"];
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
  env: Bindings,
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

/**
 * Runs Stage 2 verification: drops ghost fares (`null` or >20% & >NT$800 jump),
 * retains and tags red-eye legs, scores Deal Signals, and persists today's digest into D1.
 */
export async function refreshDailyFlights(
  db: Db,
  source: FlightSource,
  now: number,
): Promise<DailyFlightItem[]> {
  const digestDate = taipeiDate(now);
  const candidates = await source.fetchCandidates(digestDate, now);
  const rows: (typeof dailyFlights.$inferInsert)[] = [];
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

  if (rows.length > 0) {
    // D1 allows at most 100 bound parameters per query (17 columns * 5 rows = 85).
    const insertStmts = [];
    for (let i = 0; i < rows.length; i += D1_INSERT_CHUNK_SIZE) {
      insertStmts.push(db.insert(dailyFlights).values(rows.slice(i, i + D1_INSERT_CHUNK_SIZE)));
    }
    await db.batch([db.delete(dailyFlights), ...insertStmts]);
  } else {
    await db.delete(dailyFlights);
  }

  console.info(
    JSON.stringify({
      event: "daily_flights_refresh_summary",
      digestDate,
      candidates: candidates.length,
      droppedNull,
      droppedGhost,
      persisted: rows.length,
    }),
  );

  return items;
}

function buildFallbackResponse(now: number): DailyFlightsResponse {
  const today = taipeiDate(now);
  return {
    date: today,
    updatedAt: new Date(now).toISOString(),
    items: getDefaultDailyFlights(today),
    isFallback: true,
  };
}

/** Reads the latest verified daily flight digest from D1, or falls back to curated deals. */
export async function listDailyFlights(db: Db, now: number): Promise<DailyFlightsResponse> {
  const today = taipeiDate(now);
  const [latest] = await db
    .select({
      digestDate: dailyFlights.digestDate,
      createdAt: dailyFlights.createdAt,
    })
    .from(dailyFlights)
    .orderBy(desc(dailyFlights.digestDate), desc(dailyFlights.createdAt))
    .limit(1);

  if (latest === undefined) {
    return buildFallbackResponse(now);
  }

  const rows = await db
    .select()
    .from(dailyFlights)
    .where(eq(dailyFlights.digestDate, latest.digestDate))
    .orderBy(asc(dailyFlights.priceTwd));

  const upcomingRows = rows.filter((row) => row.outDate >= today);
  if (upcomingRows.length === 0) {
    return buildFallbackResponse(now);
  }

  const items: DailyFlightItem[] = upcomingRows.map((row) => {
    const meta = getDestinationMeta(row.destination);
    return {
      id: row.id,
      origin: row.origin,
      dest: row.destination,
      region: meta?.region ?? "jp",
      tripType: row.tripType,
      outDate: row.outDate,
      inDate: row.inDate,
      priceTwd: row.priceTwd,
      discountPct: row.discountPct,
      tag: row.tag,
      airlines: parseAirlinesJson(row.airlinesJson),
      transfers: row.transfers,
      returnTransfers: row.returnTransfers,
      isRedEye: row.isRedEye === 1,
      outboundDep: row.outboundDep,
      inboundDep: row.inboundDep,
    };
  });

  return {
    date: latest.digestDate,
    updatedAt: new Date(latest.createdAt).toISOString(),
    items,
    isFallback: false,
  };
}
