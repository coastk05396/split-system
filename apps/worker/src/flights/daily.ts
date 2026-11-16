import {
  getDefaultDailyFlights,
  getDestinationMeta,
  type DailyFlightItem,
  type DailyFlightsResponse,
} from "@split/shared/flights";
import { asc, desc, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { dailyFlights } from "../db/schema.js";
import {
  collectVerifiedDailyFlights,
  logDailyFlightsSummary,
  productionFlightSource,
  taipeiDate,
  type FlightCandidate,
  type FlightSource,
  type VerifiedFlightPrice,
} from "./pipeline.js";

export {
  productionFlightSource,
  taipeiDate,
  type FlightCandidate,
  type FlightSource,
  type VerifiedFlightPrice,
};

const D1_INSERT_CHUNK_SIZE = 5;

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

/**
 * Runs Stage 2 verification: drops ghost fares (`null` or >20% & >NT$800 jump),
 * retains and tags red-eye legs, scores Deal Signals, and persists today's digest into D1.
 */
export async function refreshDailyFlights(
  db: Db,
  source: FlightSource,
  now: number,
): Promise<DailyFlightItem[]> {
  const collected = await collectVerifiedDailyFlights(source, now);
  const { rows, items } = collected;

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

  logDailyFlightsSummary("daily_flights_refresh_summary", collected);

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
