import {
  getDefaultDailyFlights,
  getDestinationMeta,
  withinDepartureWindow,
  type DailyFlightItem,
  type DailyFlightsResponse,
} from "@split/shared/flights";
import { asc, desc, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { dailyFlights, dailyFlightsRuns } from "../db/schema.js";
import { resolveBaselines } from "./baseline-store.js";
import {
  collectDailyFlights,
  logDailyFlightsSummary,
  taipeiDate,
  type FlightCandidate,
  type FlightSource,
} from "./pipeline.js";
import { parseSerpApiKeys, serpApiFlightSource } from "./serpapi.js";

export { serpApiFlightSource, taipeiDate, type FlightCandidate, type FlightSource };

const D1_INSERT_CHUNK_SIZE = 5;
/** A run (and its stored fares) stays authoritative for 48 hours (one missed daily 08:00 run); after that the data is unavailable. */
const RUN_FRESH_MS = 48 * 3_600_000;

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
 * Collects today's fares and replaces the whole board in one atomic D1 batch, so a completed run never
 * carries yesterday's fares over (ADR 0013). A run that got no answer from upstream writes nothing: the
 * previous board stays until its 48 hours are up.
 */
export async function refreshDailyFlights(
  db: Db,
  source: FlightSource,
  now: number,
  env: { SERPAPI_KEYS?: string } = {},
): Promise<DailyFlightItem[]> {
  const keys = parseSerpApiKeys(env.SERPAPI_KEYS);
  const collected = await collectDailyFlights(source, now, (routes, digestDate) =>
    resolveBaselines(db, routes, now, digestDate, keys),
  );
  logDailyFlightsSummary("daily_flights_refresh_summary", collected);
  if (!collected.completed) return [];
  const { rows, items } = collected;

  // The marker says "completed with zero fares" (empty board) when no fare was admitted.
  const marker = db
    .insert(dailyFlightsRuns)
    .values({ id: 1, digestDate: collected.digestDate, completedAt: now })
    .onConflictDoUpdate({
      target: dailyFlightsRuns.id,
      set: { digestDate: collected.digestDate, completedAt: now },
    });
  // D1 allows at most 100 bound parameters per query (12 columns * 5 rows = 60).
  const insertStmts = [];
  for (let i = 0; i < rows.length; i += D1_INSERT_CHUNK_SIZE) {
    insertStmts.push(db.insert(dailyFlights).values(rows.slice(i, i + D1_INSERT_CHUNK_SIZE)));
  }
  await db.batch([db.delete(dailyFlights), marker, ...insertStmts]);

  return items;
}

function buildFallbackResponse(now: number): DailyFlightsResponse {
  const today = taipeiDate(now);
  return {
    date: today,
    updatedAt: new Date(now).toISOString(),
    items: withinDepartureWindow(getDefaultDailyFlights(today), today),
    isFallback: true,
  };
}

/** Reads the latest daily flight digest from D1, or falls back to curated deals. */
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

  // One freshness rule for stored fares and the run marker (both are written together, so the
  // manual sync path is covered too): older than RUN_FRESH_MS means unavailable, never carried over.
  const isFresh = (writtenAt: number): boolean => now - writtenAt <= RUN_FRESH_MS;
  // A completed run is an empty board, never curated fares, while it is fresh (ADR 0013).
  const [run] = await db.select().from(dailyFlightsRuns).limit(1);
  const emptyBoard = (): DailyFlightsResponse | null =>
    run !== undefined && isFresh(run.completedAt)
      ? {
          date: run.digestDate,
          updatedAt: new Date(run.completedAt).toISOString(),
          items: [],
          isFallback: false,
        }
      : null;

  if (latest === undefined) {
    return emptyBoard() ?? buildFallbackResponse(now);
  }
  if (!isFresh(latest.createdAt)) return buildFallbackResponse(now);

  const rows = await db
    .select()
    .from(dailyFlights)
    .where(eq(dailyFlights.digestDate, latest.digestDate))
    .orderBy(asc(dailyFlights.priceTwd));

  const upcomingRows = withinDepartureWindow(rows, today);
  if (upcomingRows.length === 0) {
    return emptyBoard() ?? buildFallbackResponse(now);
  }

  const items: DailyFlightItem[] = upcomingRows.map((row) => {
    const meta = getDestinationMeta(row.destination);
    return {
      id: row.id,
      origin: row.origin,
      dest: row.destination,
      region: meta?.region ?? "jp",
      outDate: row.outDate,
      inDate: row.inDate,
      priceTwd: row.priceTwd,
      discountPct: row.discountPct,
      tag: row.tag,
      airlines: parseAirlinesJson(row.airlinesJson),
      transfers: row.transfers,
    };
  });

  return {
    date: latest.digestDate,
    updatedAt: new Date(latest.createdAt).toISOString(),
    items,
    isFallback: false,
  };
}
