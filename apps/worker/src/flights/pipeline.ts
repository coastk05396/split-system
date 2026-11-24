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
  outDate: string;
  inDate: string;
  priceTwd: number;
  discountPct: number;
  tag: DealTag;
  airlinesJson: string;
  transfers: number;
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

/** Typical highs by `ORIGIN-DEST` for the admitted Routes (D1, topped up upstream), see `scoringBaseline`. */
export type ResolveBaselines = (
  routes: { origin: FlightOrigin; dest: string }[],
  digestDate: string,
) => Promise<ReadonlyMap<string, number>>;

/** Baseline tiers (ADR 0013): the Route's own typical high, then the same destination from TPE, then the static one. */
function scoringBaseline(
  fares: ReadonlyMap<string, number>,
  origin: FlightOrigin,
  dest: string,
  staticTwd: number,
): number {
  return fares.get(`${origin}-${dest}`) ?? fares.get(`TPE-${dest}`) ?? staticTwd;
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

export function sqlLiteral(value: string | number | null | undefined): string {
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
      sqlLiteral(row.outDate),
      sqlLiteral(row.inDate),
      sqlLiteral(row.priceTwd),
      sqlLiteral(row.discountPct),
      sqlLiteral(row.tag),
      sqlLiteral(row.airlinesJson),
      sqlLiteral(row.transfers),
      sqlLiteral(row.createdAt),
    ].join(", ");
    lines.push(
      `INSERT INTO daily_flights (id, digest_date, origin, destination, out_date, in_date, price_twd, discount_pct, tag, airlines_json, transfers, created_at) VALUES (${values});`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Applies the board's admission rules to the source's fares (ADR 0013): a Curated Destination, a
 * round trip departing from tomorrow to 6 months out, under 3 stops, the cheapest fare per
 * origin × destination × departure date. Every survivor is admitted, whatever its discount, and
 * scored against `resolveBaselines`' typical highs. Nothing is written to D1.
 */
export async function collectDailyFlights(
  source: FlightSource,
  now: number,
  resolveBaselines?: ResolveBaselines,
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

  const routes = new Map<string, { origin: FlightOrigin; dest: string }>();
  for (const c of cheapest.values()) {
    // Keyed on the Curated Destination's own airport code, the same key the baselines are stored under.
    const airport = getDestinationMeta(c.dest)?.airport;
    if (airport !== undefined)
      routes.set(`${c.origin}-${airport}`, { origin: c.origin, dest: airport });
  }
  const typicalHighs =
    routes.size === 0 || resolveBaselines === undefined
      ? new Map<string, number>()
      : await resolveBaselines([...routes.values()], digestDate);

  const rows: DailyFlightRow[] = [];
  const items: DailyFlightItem[] = [];
  for (const c of cheapest.values()) {
    const meta = getDestinationMeta(c.dest);
    if (meta === null || c.inDate === null) continue;
    const baseline = scoringBaseline(typicalHighs, c.origin, meta.airport, meta.baselineTwd);
    const { discountPct, tag } = computeDealSignal(c.priceTwd, baseline);
    rows.push({
      id: c.id,
      digestDate,
      origin: c.origin,
      destination: meta.airport,
      outDate: c.outDate,
      inDate: c.inDate,
      priceTwd: c.priceTwd,
      discountPct,
      tag,
      airlinesJson: JSON.stringify(c.airlines),
      transfers: c.transfers,
      createdAt: now,
    });
    items.push({
      id: c.id,
      origin: c.origin,
      dest: meta.airport,
      region: meta.region,
      outDate: c.outDate,
      inDate: c.inDate,
      priceTwd: c.priceTwd,
      discountPct,
      tag,
      airlines: c.airlines,
      transfers: c.transfers,
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
