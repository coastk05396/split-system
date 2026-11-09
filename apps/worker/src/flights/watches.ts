import {
  createFlightWatchSchema,
  type CreateFlightWatch,
  type FlightPriceWatch,
} from "@split/shared";
import type { Bindings } from "../env.js";
import { ApiError } from "../errors.js";
import { lineUserIdOf, MAX_LINE_WATCHES } from "./line-push.js";

export interface WatchRow {
  id: string;
  user_id: string;
  intent_json: string;
  baseline_fare: number;
  target_fare: number;
  channel: "web_push" | "line_push";
  status: FlightPriceWatch["status"];
  latest_fare: number | null;
  checked_at: number | null;
  created_at: number;
  departure_date: string;
}
export function watchFromRow(row: WatchRow): FlightPriceWatch {
  const intent: unknown = JSON.parse(row.intent_json);
  const input = createFlightWatchSchema.parse({
    intent,
    baselineFare: row.baseline_fare,
    targetFare: row.target_fare,
    channel: row.channel,
  });
  return {
    ...input,
    id: row.id,
    status: row.status,
    latestFare: row.latest_fare,
    checkedAt: row.checked_at,
    createdAt: row.created_at,
  };
}
export async function expireWatches(db: D1Database, now: number): Promise<void> {
  await db
    .prepare(
      "UPDATE flight_price_watches SET status='expired',claim_token=NULL,claim_until=0 WHERE status='active' AND (departure_date<? OR created_at<=?)",
    )
    .bind(new Date(now).toISOString().slice(0, 10), now - 60 * 86400_000)
    .run();
}
export async function createFlightWatch(
  env: Bindings,
  userId: string,
  input: CreateFlightWatch,
  now: number,
): Promise<FlightPriceWatch> {
  // LINE Push needs a LINE Identity to address the message to.
  if (input.channel === "line_push" && (await lineUserIdOf(env.DB, userId)) === null)
    throw new ApiError("VALIDATION_FAILED");
  if (input.intent.departureDate < new Date(now).toISOString().slice(0, 10))
    throw new ApiError("VALIDATION_FAILED");
  await expireWatches(env.DB, now);
  const id = crypto.randomUUID();
  const intent = JSON.stringify(input.intent);
  const result = await env.DB.prepare(
    "INSERT INTO flight_price_watches(id,user_id,intent_json,baseline_fare,target_fare,channel,created_at,departure_date) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM flight_price_watches WHERE user_id=? AND channel=? AND status='active')<? ON CONFLICT DO NOTHING",
  )
    .bind(
      id,
      userId,
      intent,
      input.baselineFare,
      input.targetFare,
      input.channel,
      now,
      input.intent.departureDate,
      userId,
      input.channel,
      input.channel === "line_push" ? MAX_LINE_WATCHES : 5,
    )
    .run();
  if (!result.meta.changes) {
    const existing = await env.DB.prepare(
      "SELECT * FROM flight_price_watches WHERE user_id=? AND intent_json=? AND channel=? AND status='active'",
    )
      .bind(userId, intent, input.channel)
      .first<WatchRow>();
    if (existing) return watchFromRow(existing);
    throw new ApiError("FLIGHT_WATCH_LIMIT");
  }
  return { ...input, id, status: "active", latestFare: null, checkedAt: null, createdAt: now };
}
