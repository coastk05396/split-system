import type { Db } from "../db/client.js";
import { flightBaselines } from "../db/schema.js";
import {
  BASELINE_REQUESTS_PER_SPARE_KEY,
  BASELINE_TTL_MS,
  baselineKey,
  fetchTypicalRange,
  type BaselineRoute,
  type TypicalRange,
} from "./baselines.js";
import { createSerpApiClient, type FetchFn } from "./serpapi.js";

/** Fresh Baselines keyed `ORIGIN-DEST`, as the pipeline's three-tier resolution reads them. */

/** Reads the stored Baselines that are still within their 30 days. */
export async function loadFreshBaselines(db: Db, now: number): Promise<Map<string, number>> {
  const rows = await db.select().from(flightBaselines);
  return new Map(
    rows
      .filter((r) => now - r.fetchedAt <= BASELINE_TTL_MS)
      .map((r) => [baselineKey(r.origin, r.destination), r.typicalHighTwd]),
  );
}

/**
 * Resolves each Route's typical high for scoring: what D1 holds (fresh), topped up with a bounded
 * number of `google_flights` requests when a spare SerpApi key exists. The first key is the Explore
 * queries' and stays untouched, so a single key spends nothing here. Taipei routes go first.
 */
export async function resolveBaselines(
  db: Db,
  routes: readonly BaselineRoute[],
  now: number,
  digestDate: string,
  keys: readonly string[],
  upstreamFetch?: FetchFn,
): Promise<Map<string, number>> {
  const fresh = await loadFreshBaselines(db, now);
  const spare = keys.slice(1);
  if (spare.length === 0) return fresh;

  const budget = spare.length * BASELINE_REQUESTS_PER_SPARE_KEY;
  const missing = routes
    .filter((r) => !fresh.has(baselineKey(r.origin, r.dest)))
    .sort((a, b) => Number(b.origin === "TPE") - Number(a.origin === "TPE"))
    .slice(0, budget);
  if (missing.length === 0) return fresh;

  const client = createSerpApiClient(spare, upstreamFetch ?? ((input, init) => fetch(input, init)));
  const found: TypicalRange[] = [];
  for (const route of missing) {
    const range = await fetchTypicalRange(client, route, digestDate);
    if (range !== null) found.push(range);
  }
  for (const r of found) {
    fresh.set(baselineKey(r.origin, r.dest), r.typicalHighTwd);
    await db
      .insert(flightBaselines)
      .values({
        origin: r.origin,
        destination: r.dest,
        typicalLowTwd: r.typicalLowTwd,
        typicalHighTwd: r.typicalHighTwd,
        fetchedAt: now,
      })
      .onConflictDoUpdate({
        target: [flightBaselines.origin, flightBaselines.destination],
        set: {
          typicalLowTwd: r.typicalLowTwd,
          typicalHighTwd: r.typicalHighTwd,
          fetchedAt: now,
        },
      });
  }
  console.info(
    JSON.stringify({
      event: "flight_baselines_refreshed",
      requested: missing.length,
      stored: found.length,
    }),
  );
  return fresh;
}
