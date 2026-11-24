import {
  computeDealSignal,
  departureBounds,
  getDestinationMeta,
  type DailyFlightItem,
  type DealTag,
  type FlightOrigin,
} from "@split/shared/flights";

export interface DailyFlightRow {
  id: string;
  digestDate: string;
  origin: FlightOrigin;
  destination: string;
  tripType: "rt";
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

/** One round-trip fare as the source found it, before the board's admission rules. */
export interface FlightCandidate {
  id: string;
  origin: FlightOrigin;
  dest: string;
  outDate: string;
  inDate: string | null;
  priceTwd: number;
  airlines: string[];
  transfers: number;
  /** The Route's typical-high price used to score the Deal Signal; null/absent means no discount shown. */
  dealBaselineTwd?: number | null;
}

export interface FlightSource {
  fetchCandidates(digestDate: string, now?: number): Promise<FlightCandidate[]>;
  /** Upstream requests made since the last `fetchCandidates` started, for the run summary. */
  upstreamCalls?(): number;
  /** Queries of the last run that got an answer; 0 means upstream was unavailable (not "no fares"). */
  answeredQueries?(): number;
}

/** A fare with 3 or more stops is never shown. */
const MAX_STOPS_EXCLUSIVE = 3;
const TAIPEI_OFFSET_MS = 8 * 3_600_000;

/** Current YYYY-MM-DD in Asia/Taipei (`UTC+8`). */
export function taipeiDate(now: number): string {
  return new Date(now + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}

export interface CollectedDailyFlights {
  digestDate: string;
  candidates: number;
  /** The run got answers from upstream (even with no admissible fare), so an empty board is a real answer. */
  completed: boolean;
  /** Upstream requests this run used. */
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
      completed: collected.completed,
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
export function formatDailyFlightsSyncSql(
  rows: readonly DailyFlightRow[],
  completedRun?: { digestDate: string; at: number },
): string {
  const lines = ["DELETE FROM daily_flights;"];
  lines.push(
    completedRun
      ? `INSERT OR REPLACE INTO daily_flights_runs (id, digest_date, completed_at) VALUES (1, ${sqlLiteral(completedRun.digestDate)}, ${sqlLiteral(completedRun.at)});`
      : "DELETE FROM daily_flights_runs;",
  );
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
 * Applies the board's admission rules to the source's fares (ADR 0013): a Curated Destination, a
 * round trip departing from tomorrow to 6 months out, under 3 stops, the cheapest fare per
 * origin × destination × departure date. Every survivor is admitted, whatever its discount.
 * Nothing is written to D1.
 */
export async function collectDailyFlights(
  source: FlightSource,
  now: number,
): Promise<CollectedDailyFlights> {
  const digestDate = taipeiDate(now);
  const candidates = await source.fetchCandidates(digestDate, now);
  const window = departureBounds(digestDate);

  const cheapest = new Map<string, FlightCandidate>();
  for (const c of candidates) {
    if (getDestinationMeta(c.dest) === null || c.priceTwd <= 0) continue;
    if (c.outDate < window.from || c.outDate > window.to) continue;
    if (c.inDate === null || c.inDate <= c.outDate) continue;
    if (c.transfers >= MAX_STOPS_EXCLUSIVE || c.airlines.length === 0) continue;
    const key = `${c.origin}-${c.dest}-${c.outDate}`;
    const held = cheapest.get(key);
    if (held === undefined || c.priceTwd < held.priceTwd) cheapest.set(key, c);
  }

  const rows: DailyFlightRow[] = [];
  const items: DailyFlightItem[] = [];
  for (const c of cheapest.values()) {
    const meta = getDestinationMeta(c.dest);
    if (meta === null) continue;
    const baseline = c.dealBaselineTwd ?? meta.baselineTwd;
    const { discountPct, tag } = computeDealSignal(c.priceTwd, baseline);
    rows.push({
      id: c.id,
      digestDate,
      origin: c.origin,
      destination: meta.airport,
      tripType: "rt",
      outDate: c.outDate,
      inDate: c.inDate,
      priceTwd: c.priceTwd,
      discountPct,
      tag,
      airlinesJson: JSON.stringify(c.airlines),
      transfers: c.transfers,
      returnTransfers: null,
      isRedEye: 0,
      outboundDep: null,
      inboundDep: null,
      createdAt: now,
    });
    items.push({
      id: c.id,
      origin: c.origin,
      dest: meta.airport,
      region: meta.region,
      tripType: "rt",
      outDate: c.outDate,
      inDate: c.inDate,
      priceTwd: c.priceTwd,
      discountPct,
      tag,
      airlines: c.airlines,
      transfers: c.transfers,
      returnTransfers: null,
      isRedEye: false,
      outboundDep: null,
      inboundDep: null,
    });
  }

  return {
    digestDate,
    candidates: candidates.length,
    completed: (source.answeredQueries?.() ?? candidates.length) > 0,
    upstreamCalls: source.upstreamCalls?.() ?? 0,
    rows,
    items,
  };
}
