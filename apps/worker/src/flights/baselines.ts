import type { FlightOrigin } from "@split/shared/flights";
import { z } from "zod";
import { sqlLiteral } from "./pipeline.js";
import {
  createSerpApiClient,
  type FetchFn,
  type SerpApiClient,
  type SerpApiKeys,
} from "./serpapi.js";

const DAY_MS = 86_400_000;
/** A stored Baseline is reused for 30 days, then fetched again (ADR 0013). */
export const BASELINE_TTL_MS = 30 * DAY_MS;
/** Baseline requests the Baseline key may spend in a daily run (ADR 0014). */
export const BASELINE_REQUESTS_PER_DAY = 8;

export interface BaselineRoute {
  origin: FlightOrigin;
  dest: string;
}

export interface TypicalRange extends BaselineRoute {
  typicalLowTwd: number;
  typicalHighTwd: number;
}

const range = (origin: FlightOrigin, dests: string): BaselineRoute[] =>
  dests.split(" ").map((dest) => ({ origin, dest }));

/** The 50 Routes the seed CLI covers: the busiest Curated Destinations from each queried origin (no `TSA`, ADR 0016). */
export const CORE_BASELINE_ROUTES: readonly BaselineRoute[] = [
  ...range(
    "TPE",
    "NRT HND KIX FUK OKA CTS NGO KMJ KOJ HIJ SDJ ICN PUS CJU BKK CNX SIN KUL DAD SGN HAN MNL DPS HKT BKI PQC CEB HKG MFM PVG PEK CAN SZX LHR CDG LAX SFO SYD",
  ),
  ...range("KHH", "NRT KIX FUK OKA CTS ICN BKK SIN KUL HKG DAD MNL"),
];

const googleFlightsSchema = z.object({
  price_insights: z.object({
    typical_price_range: z.tuple([z.number().positive(), z.number().positive()]),
  }),
});

const dateAfter = (digestDate: string, days: number): string =>
  new Date(Date.parse(`${digestDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/**
 * One `google_flights` request for a Route's typical price range. A failed request, or an answer
 * without a usable range, is `null`: it is never stored, so the next run asks again.
 */
export async function fetchTypicalRange(
  client: SerpApiClient,
  route: BaselineRoute,
  digestDate: string,
): Promise<TypicalRange | null> {
  const parsed = googleFlightsSchema.safeParse(
    await client.get("baseline", {
      engine: "google_flights",
      departure_id: route.origin,
      arrival_id: route.dest,
      type: "1",
      // The range describes the Route, not the dates; a round trip a month out is a typical probe.
      outbound_date: dateAfter(digestDate, 30),
      return_date: dateAfter(digestDate, 34),
      currency: "TWD",
      hl: "en",
      gl: "tw",
    }),
  );
  if (!parsed.success) return null;
  const [low, high] = parsed.data.price_insights.typical_price_range;
  if (low > high) return null;
  return {
    ...route,
    typicalLowTwd: Math.round(low),
    typicalHighTwd: Math.round(high),
  };
}

/** Fetches ranges one after another with the Baseline key; Routes that got no usable answer are left out. */
export async function fetchTypicalRanges(
  env: SerpApiKeys,
  routes: readonly BaselineRoute[],
  now: number,
  upstreamFetch: FetchFn = (input, init) => fetch(input, init),
  digestDate = new Date(now + 8 * 3_600_000).toISOString().slice(0, 10),
): Promise<TypicalRange[]> {
  const client = createSerpApiClient(env, upstreamFetch);
  const ranges: TypicalRange[] = [];
  for (const route of routes) {
    const found = await fetchTypicalRange(client, route, digestDate);
    if (found !== null) ranges.push(found);
  }
  return ranges;
}

/** `INSERT OR REPLACE` statements (one per line, `;` separated) for `wrangler d1 execute --file`. */
export function formatBaselineSql(ranges: readonly TypicalRange[], now: number): string {
  if (ranges.length === 0) return "";
  return `${ranges
    .map(
      (r) =>
        `INSERT OR REPLACE INTO flight_baselines (origin, destination, typical_low_twd, typical_high_twd, fetched_at) VALUES ('${r.origin}', '${r.dest.replaceAll("'", "''")}', ${sqlLiteral(r.typicalLowTwd)}, ${sqlLiteral(r.typicalHighTwd)}, ${sqlLiteral(now)})`,
    )
    .join(";\n")};\n`;
}

export const baselineKey = (origin: string, dest: string): string => `${origin}-${dest}`;

/** The SELECT that reads the Baselines still within their 30 days, for `wrangler d1 execute --json`. */
export const freshBaselinesSql = (now: number): string =>
  `SELECT origin, destination, typical_high_twd FROM flight_baselines WHERE fetched_at >= ${sqlLiteral(now - BASELINE_TTL_MS)}`;

const wranglerRowsSchema = z.array(
  z.object({
    results: z.array(
      z.object({ origin: z.string(), destination: z.string(), typical_high_twd: z.number() }),
    ),
  }),
);

/** Typical highs by `ORIGIN-DEST` out of `wrangler d1 execute --json` stdout of `freshBaselinesSql`. */
export function parseWranglerBaselines(stdout: string): Map<string, number> {
  const rows = wranglerRowsSchema.parse(JSON.parse(stdout)).flatMap((r) => r.results);
  return new Map(rows.map((r) => [baselineKey(r.origin, r.destination), r.typical_high_twd]));
}
