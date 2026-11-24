import type { Db } from "../db/client.js";
import { flightBaselines } from "../db/schema.js";
import {
  BASELINE_REQUESTS_PER_DAY,
  BASELINE_TTL_MS,
  baselineKey,
  fetchTypicalRange,
  type BaselineRoute,
  type TypicalRange,
} from "./baselines.js";
import { createSerpApiClient, type FetchFn, type SerpApiKeys } from "./serpapi.js";

/**
 * Resolves each Route's typical high for scoring: what D1 holds (fresh), topped up with a bounded
 * number of `google_flights` requests on the Baseline key (ADR 0014), which pays for nothing else.
 * Routes with no stored Baseline go before expired ones, Taipei routes before the rest within each.
 * Without that key, or once it is refused, D1's Baselines are all there is.
 */
export async function resolveBaselines(
  db: Db,
  routes: readonly BaselineRoute[],
  now: number,
  digestDate: string,
  env: SerpApiKeys,
  upstreamFetch?: FetchFn,
): Promise<Map<string, number>> {
  const stored = await db.select().from(flightBaselines);
  const everStored = new Set(stored.map((r) => baselineKey(r.origin, r.destination)));
  const fresh = new Map(
    stored
      .filter((r) => now - r.fetchedAt <= BASELINE_TTL_MS)
      .map((r) => [baselineKey(r.origin, r.destination), r.typicalHighTwd]),
  );
  const key = (r: BaselineRoute) => baselineKey(r.origin, r.dest);
  const missing = routes
    .filter((r) => !fresh.has(key(r)))
    .sort(
      (a, b) =>
        Number(everStored.has(key(a))) - Number(everStored.has(key(b))) ||
        Number(b.origin === "TPE") - Number(a.origin === "TPE"),
    )
    .slice(0, BASELINE_REQUESTS_PER_DAY);
  if (missing.length === 0) return fresh;

  const client = createSerpApiClient(env, upstreamFetch ?? ((input, init) => fetch(input, init)));
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
