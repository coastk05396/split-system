import {
  computeDealSignal,
  FLIGHT_ORIGINS,
  getDefaultDailyFlights,
  getDestinationMeta,
  hasRedEyeLeg,
  isGhostFare,
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
}

export interface VerifiedFlightPrice {
  priceTwd: number | null;
  outboundDep?: string | null;
  inboundDep?: string | null;
  outboundArr?: string | null;
  inboundArr?: string | null;
}

export interface FlightSource {
  fetchCandidates(digestDate: string): Promise<FlightCandidate[]>;
  verifyCandidate?(candidate: FlightCandidate): Promise<VerifiedFlightPrice | null>;
}

const REGION_LIMITS: Readonly<Record<FlightRegion, number>> = {
  jp: 14,
  kr: 6,
  sea: 8,
  hkmo: 4,
  longhaul: 8,
};

const SCAN_ORIGINS: readonly FlightOrigin[] = ["TPE", "KHH", "RMQ", "TSA"];

const D1_INSERT_CHUNK_SIZE = 5;

const travelpayoutsItemSchema = z.object({
  origin: z.string(),
  destination: z.string(),
  airline: z.string().optional().default("CI"),
  departure_at: z.string().optional().nullable(),
  return_at: z.string().optional().nullable(),
  price: z.number().positive(),
  transfers: z.number().int().min(0).optional().default(0),
  return_transfers: z.number().int().min(0).optional().nullable(),
  duration: z.number().int().positive().optional().nullable(),
  duration_to: z.number().int().positive().optional().nullable(),
  duration_back: z.number().int().positive().optional().nullable(),
});

const travelpayoutsResponseSchema = z.object({
  success: z.boolean().optional(),
  data: z.array(travelpayoutsItemSchema).optional().default([]),
});

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const TAIPEI_OFFSET_MS = 8 * 3_600_000;

/** Current YYYY-MM-DD in Asia/Taipei (`UTC+8`). */
export function taipeiDate(now: number): string {
  return new Date(now + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}

function toFlightOrigin(code: string): FlightOrigin | null {
  const upper = code.toUpperCase();
  return (FLIGHT_ORIGINS as readonly string[]).includes(upper) ? (upper as FlightOrigin) : null;
}

function extractTimePart(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const match = iso.match(/T(\d{2}:\d{2})/);
  return match?.[1] ?? null;
}

function extractArrivalTimePart(
  depIso: string | null | undefined,
  durationMinutes: number | null | undefined,
): string | null {
  if (
    !depIso ||
    durationMinutes === null ||
    durationMinutes === undefined ||
    durationMinutes <= 0
  ) {
    return null;
  }
  const depHm = extractTimePart(depIso);
  if (!depHm) return null;
  const parts = depHm.split(":");
  const totalMinutes = (Number(parts[0]) * 60 + Number(parts[1]) + durationMinutes) % (24 * 60);
  const arrH = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const arrM = String(totalMinutes % 60).padStart(2, "0");
  return `${arrH}:${arrM}`;
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

/**
 * Stage 1 & 2 production source: discovers Taiwan-outbound fares via Travelpayouts
 * (`v3/prices_for_dates`) and verifies each route's live fare before persistence.
 * Falls back to curated baseline seed candidates when `TRAVELPAYOUTS_TOKEN` is unset.
 */
export function productionFlightSource(
  env: Bindings,
  fetchFn: FetchFn = (input, init) => fetch(input, init),
): FlightSource {
  return {
    async fetchCandidates(digestDate) {
      const seeds = getDefaultDailyFlights(digestDate).map<FlightCandidate>((item) => ({
        id: item.id,
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
      }));

      const token = env.TRAVELPAYOUTS_TOKEN;
      if (!token) return seeds;

      const collected: FlightCandidate[] = [];
      const seenKeys = new Set<string>();

      for (const origin of SCAN_ORIGINS) {
        for (const oneWay of [false, true]) {
          try {
            const url = new URL("https://api.travelpayouts.com/aviasales/v3/prices_for_dates");
            url.searchParams.set("origin", origin);
            url.searchParams.set("currency", "twd");
            url.searchParams.set("unique", "true");
            url.searchParams.set("sorting", "price");
            url.searchParams.set("limit", "30");
            url.searchParams.set("one_way", oneWay ? "true" : "false");

            const res = await fetchFn(url.toString(), {
              headers: { "X-Access-Token": token },
              signal: AbortSignal.timeout(8_000),
            });
            if (!res.ok) {
              console.warn(
                JSON.stringify({
                  event: "travelpayouts_fetch_failed",
                  origin,
                  oneWay,
                  status: res.status,
                }),
              );
              continue;
            }

            const body = travelpayoutsResponseSchema.parse(await res.json());
            for (const raw of body.data) {
              const parsedOrigin = toFlightOrigin(raw.origin);
              const meta = getDestinationMeta(raw.destination);
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
                outboundArr: extractArrivalTimePart(
                  raw.departure_at,
                  raw.duration_to ?? raw.duration,
                ),
                inboundArr: extractArrivalTimePart(raw.return_at, raw.duration_back),
              });
            }
          } catch (error) {
            console.warn(
              JSON.stringify({
                event: "travelpayouts_fetch_failed",
                origin,
                oneWay,
                error: String(error),
              }),
            );
          }
        }
      }

      if (collected.length === 0) return seeds;
      return balanceByRegion(collected);
    },

    async verifyCandidate(candidate) {
      const token = env.TRAVELPAYOUTS_TOKEN;
      if (!token || candidate.id.includes("-seed-")) {
        return {
          priceTwd: candidate.priceTwd,
          outboundDep: candidate.outboundDep,
          inboundDep: candidate.inboundDep,
          outboundArr: candidate.outboundArr ?? null,
          inboundArr: candidate.inboundArr ?? null,
        };
      }

      try {
        const url = new URL("https://api.travelpayouts.com/aviasales/v3/prices_for_dates");
        url.searchParams.set("origin", candidate.origin);
        url.searchParams.set("destination", candidate.dest);
        url.searchParams.set("departure_at", candidate.outDate);
        if (candidate.tripType === "rt" && candidate.inDate) {
          url.searchParams.set("return_at", candidate.inDate);
        }
        url.searchParams.set("one_way", candidate.tripType === "ow" ? "true" : "false");
        url.searchParams.set("currency", "twd");
        url.searchParams.set("sorting", "price");
        url.searchParams.set("limit", "5");

        const res = await fetchFn(url.toString(), {
          headers: { "X-Access-Token": token },
          signal: AbortSignal.timeout(8_000),
        });
        if (!res.ok) {
          console.warn(
            JSON.stringify({
              event: "travelpayouts_verify_failed",
              id: candidate.id,
              status: res.status,
            }),
          );
          return null;
        }

        const body = travelpayoutsResponseSchema.parse(await res.json());
        const best = body.data[0];
        if (!best) return null;

        return {
          priceTwd: Math.round(best.price),
          outboundDep: extractTimePart(best.departure_at) ?? candidate.outboundDep,
          inboundDep: extractTimePart(best.return_at) ?? candidate.inboundDep,
          outboundArr:
            extractArrivalTimePart(best.departure_at, best.duration_to ?? best.duration) ??
            candidate.outboundArr ??
            null,
          inboundArr:
            extractArrivalTimePart(best.return_at, best.duration_back) ??
            candidate.inboundArr ??
            null,
        };
      } catch (error) {
        console.warn(
          JSON.stringify({
            event: "travelpayouts_verify_failed",
            id: candidate.id,
            error: String(error),
          }),
        );
        return null;
      }
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
  _env: Bindings,
  now: number,
): Promise<DailyFlightItem[]> {
  const digestDate = taipeiDate(now);
  const candidates = await source.fetchCandidates(digestDate);
  const rows: (typeof dailyFlights.$inferInsert)[] = [];
  const items: DailyFlightItem[] = [];

  for (const candidate of candidates) {
    const meta = getDestinationMeta(candidate.dest);
    if (meta === null || candidate.priceTwd <= 0) continue;

    let finalPrice = candidate.priceTwd;
    let outboundDep = candidate.outboundDep;
    let inboundDep = candidate.inboundDep;
    let outboundArr = candidate.outboundArr ?? null;
    let inboundArr = candidate.inboundArr ?? null;

    if (source.verifyCandidate !== undefined) {
      const verified = await source.verifyCandidate(candidate);
      if (verified === null || isGhostFare(candidate.priceTwd, verified.priceTwd)) {
        continue;
      }
      if (verified.priceTwd !== null) {
        finalPrice = Math.round(verified.priceTwd);
      }
      if (verified.outboundDep !== undefined) outboundDep = verified.outboundDep;
      if (verified.inboundDep !== undefined) inboundDep = verified.inboundDep;
      if (verified.outboundArr !== undefined) outboundArr = verified.outboundArr;
      if (verified.inboundArr !== undefined) inboundArr = verified.inboundArr;
    }

    const isRedEye = hasRedEyeLeg([outboundDep, inboundDep, outboundArr, inboundArr]);
    const baseline =
      candidate.tripType === "ow" ? Math.round(meta.baselineTwd * 0.58) : meta.baselineTwd;
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
      airlinesJson: JSON.stringify(candidate.airlines),
      transfers: candidate.transfers,
      returnTransfers: candidate.returnTransfers,
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
      airlines: candidate.airlines,
      transfers: candidate.transfers,
      returnTransfers: candidate.returnTransfers,
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
    await db.delete(dailyFlights).where(eq(dailyFlights.digestDate, digestDate));
  }

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
