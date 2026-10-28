import { lt, sql } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import type { SignedInEnv } from "./auth/require-user.js";
import { createDb, type Db } from "./db/client.js";
import { rateCounters } from "./db/schema.js";
import { ApiError } from "./errors.js";

/**
 * Per-User write limits after sign-in (decision 27), counted in D1 in fixed windows.
 * Only signed-in requests are counted, so anonymous callers cannot burn D1 writes; sign-in
 * itself is limited by the WAF rule on `/api/v1/auth/*`.
 */
export const RATE_LIMITS = {
  expense_write: { limit: 30, windowMs: 60_000 },
  receipt_upload: { limit: 10, windowMs: 60_000 },
  invite_join: { limit: 10, windowMs: 60_000 },
  group_create: { limit: 5, windowMs: 3_600_000 },
} as const satisfies Record<string, { limit: number; windowMs: number }>;

export type RouteGroup = keyof typeof RATE_LIMITS;

/** Counters older than this are purged whenever a counter is written. */
const RETENTION_MS = 3_600_000;

/** Counts one write; throws 429 RATE_LIMITED with `Retry-After` once the window is full. */
export async function consumeRateLimit(
  db: Db,
  userId: string,
  routeGroup: RouteGroup,
  now: number,
): Promise<void> {
  const { limit, windowMs } = RATE_LIMITS[routeGroup];
  const windowStart = now - (now % windowMs);
  const [, counted] = await db.batch([
    db.delete(rateCounters).where(lt(rateCounters.windowStart, now - RETENTION_MS)),
    db
      .insert(rateCounters)
      .values({ userId, routeGroup, windowStart, count: 1 })
      .onConflictDoUpdate({
        target: [rateCounters.userId, rateCounters.routeGroup, rateCounters.windowStart],
        set: { count: sql`${rateCounters.count} + 1` },
      })
      .returning({ count: rateCounters.count }),
  ]);
  const count = counted[0]?.count ?? 1;
  if (count > limit) {
    const retryAfter = Math.ceil((windowStart + windowMs - now) / 1000);
    throw new ApiError("RATE_LIMITED", undefined, { "Retry-After": String(retryAfter) });
  }
}

/** Route middleware for later tickets: `.post("/groups", requireUser(now), rateLimit(...), ...)`. */
export function rateLimit(routeGroup: RouteGroup, now: () => number) {
  return createMiddleware<SignedInEnv>(async (c, next) => {
    await consumeRateLimit(createDb(c.env.DB), c.var.userId, routeGroup, now());
    await next();
  });
}
