import { and, asc, eq, lt } from "drizzle-orm";
import { createDb } from "./db/client.js";
import { commitAccountCleanups } from "./auth/account-cleanup.js";
import { productionDeps } from "./deps.js";
import type { Bindings } from "./env.js";
import { groupLedger } from "./ledger-client.js";
import { refreshRates } from "./rates/rates.js";
import { groupReservations, linkCodes, rateCounters, sessions } from "./db/schema.js";
import { RATE_COUNTER_RETENTION_MS } from "./rate-limit.js";

/** Old pending reservations need an authoritative membership check before release. */
const STALE_RESERVATION_MS = 24 * 60 * 60 * 1000;

/** Purges expired records and releases only reservations the ledger confirms are unused. */
export async function purgeExpired(env: Bindings, now: number): Promise<void> {
  const db = createDb(env.DB);
  try {
    await env.DB.prepare("DELETE FROM flight_search_cache WHERE expires_at <= ?").bind(now).run();
    await db.batch([
      db.delete(sessions).where(lt(sessions.expiresAt, now)),
      db.delete(linkCodes).where(lt(linkCodes.expiresAt, now)),
      db.delete(rateCounters).where(lt(rateCounters.windowStart, now - RATE_COUNTER_RETENTION_MS)),
    ]);
    const stale = await db
      .select()
      .from(groupReservations)
      .where(
        and(
          eq(groupReservations.status, "pending"),
          lt(groupReservations.createdAt, now - STALE_RESERVATION_MS),
        ),
      )
      .orderBy(asc(groupReservations.createdAt))
      .limit(100);
    for (const reservation of stale) {
      try {
        const seated = await Promise.race([
          groupLedger(env, reservation.groupId).isMember(reservation.userId),
          new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(new Error("member check timed out"));
            }, 5_000);
          }),
        ]);
        if (seated) {
          // Seated: settle the row ourselves so a delayed projection cannot crowd the next runs.
          await db
            .update(groupReservations)
            .set({ status: "active" })
            .where(
              and(
                eq(groupReservations.userId, reservation.userId),
                eq(groupReservations.groupId, reservation.groupId),
                eq(groupReservations.status, "pending"),
              ),
            );
          continue;
        }
        await db
          .delete(groupReservations)
          .where(
            and(
              eq(groupReservations.userId, reservation.userId),
              eq(groupReservations.groupId, reservation.groupId),
              eq(groupReservations.status, "pending"),
              eq(groupReservations.createdAt, reservation.createdAt),
            ),
          );
      } catch {
        // An uncertain membership keeps its reservation for the next daily check.
      }
    }
  } catch (error) {
    console.error(
      JSON.stringify({ event: "expired_records_cleanup_failed", error: String(error) }),
    );
  }
}

/** Daily maintenance keeps account cleanup ahead of the reference-rate refresh. */
export async function dailyMaintenance(env: Bindings, now: number): Promise<void> {
  const db = createDb(env.DB);
  await purgeExpired(env, now);
  await commitAccountCleanups(env);
  await refreshRates(db, productionDeps.rateSource, now);
}
