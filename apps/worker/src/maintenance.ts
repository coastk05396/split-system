import { lt } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { rateCounters, sessions } from "./db/schema.js";
import { RATE_COUNTER_RETENTION_MS } from "./rate-limit.js";

/** Daily clean-up: lapsed sessions and old rate counters are never read again. */
export async function purgeExpired(db: Db, now: number): Promise<void> {
  await db.batch([
    db.delete(sessions).where(lt(sessions.expiresAt, now)),
    db.delete(rateCounters).where(lt(rateCounters.windowStart, now - RATE_COUNTER_RETENTION_MS)),
  ]);
}
