import { gte, lt, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { flightBaselines } from "../db/schema.js";
import { BASELINE_CACHE_TTL_MS, type BaselineCache } from "./pipeline.js";

// D1 allows at most 100 bound parameters per query (7 columns * 14 rows = 98).
const UPSERT_CHUNK_SIZE = 14;

/** D1-backed `BaselineCache`: fresh rows are served for `BASELINE_CACHE_TTL_MS`, older rows are pruned on save. */
export function d1BaselineCache(db: Db): BaselineCache {
  return {
    async load(now) {
      const rows = await db
        .select()
        .from(flightBaselines)
        .where(gte(flightBaselines.fetchedAt, now - BASELINE_CACHE_TTL_MS));
      return rows.map((r) => ({
        origin: r.origin,
        dest: r.destination,
        tripType: r.tripType,
        month: r.month,
        stopClass: r.stopClass,
        baselineTwd: r.baselineTwd,
      }));
    },

    async save(entries, now) {
      const upserts = [];
      for (let i = 0; i < entries.length; i += UPSERT_CHUNK_SIZE) {
        upserts.push(
          db
            .insert(flightBaselines)
            .values(
              entries.slice(i, i + UPSERT_CHUNK_SIZE).map((e) => ({
                origin: e.origin,
                destination: e.dest,
                tripType: e.tripType,
                month: e.month,
                stopClass: e.stopClass,
                baselineTwd: e.baselineTwd,
                fetchedAt: now,
              })),
            )
            .onConflictDoUpdate({
              target: [
                flightBaselines.origin,
                flightBaselines.destination,
                flightBaselines.tripType,
                flightBaselines.month,
                flightBaselines.stopClass,
              ],
              set: {
                baselineTwd: sql`excluded.baseline_twd`,
                fetchedAt: sql`excluded.fetched_at`,
              },
            }),
        );
      }
      await db.batch([
        db
          .delete(flightBaselines)
          .where(lt(flightBaselines.fetchedAt, now - BASELINE_CACHE_TTL_MS)),
        ...upserts,
      ]);
    },
  };
}
