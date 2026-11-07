import {
  formatAmount,
  intentToQuery,
  pushSubscriptionSchema,
  type FlightCard,
} from "@split/shared";
import type { AppDeps } from "../deps.js";
import type { Bindings } from "../env.js";
import { flightBubble } from "../line/flight-flex.js";
import { LinePushRejectedError } from "../line/reply-client.js";
import { lineUserIdOf, releaseLinePush, reserveLinePush } from "./line-push.js";
import { buildFlightReply, lookupFares } from "./search.js";
import { expireWatches, watchFromRow, type WatchRow } from "./watches.js";
import { sendWebPush } from "./web-push.js";

export async function maintainFlightWatches(env: Bindings, deps: AppDeps): Promise<void> {
  const now = deps.now();
  await expireWatches(env.DB, now);
  const watches = await env.DB.prepare(
    "SELECT * FROM flight_price_watches WHERE status='active' AND claim_until<? ORDER BY COALESCE(checked_at,0),created_at",
  )
    .bind(now)
    .all<WatchRow>();
  for (const row of watches.results) {
    // One watch's failure must not stop the others from being checked.
    try {
      await maintainWatch(env, deps, row, now);
    } catch (error) {
      logWatchFailure(error);
    }
  }
}

/** Logs the error class only: messages can carry watch, user or LINE identifiers. */
function logWatchFailure(error: unknown): void {
  console.error(
    JSON.stringify({
      event: "flight_watch_failed",
      error: error instanceof Error ? error.name : "unknown",
    }),
  );
}

async function maintainWatch(
  env: Bindings,
  deps: AppDeps,
  row: WatchRow,
  now: number,
): Promise<void> {
  const token = crypto.randomUUID();
  const claimed = await env.DB.prepare(
    "UPDATE flight_price_watches SET claim_token=?,claim_until=? WHERE id=? AND status='active' AND claim_until<?",
  )
    .bind(token, now + 5 * 60_000, row.id, now)
    .run();
  if (!claimed.meta.changes) return;
  let triggered = false;
  try {
    const watch = watchFromRow(row);
    const result = await lookupFares(env, deps, watch.intent);
    const reply = await buildFlightReply(env, watch.intent, result.fares, result.degraded, now);
    const minimum = reply.cards.reduce<number | null>(
      (price, card) => (price === null ? card.price : Math.min(price, card.price)),
      null,
    );
    await env.DB.prepare(
      "UPDATE flight_price_watches SET latest_fare=?,checked_at=? WHERE id=? AND claim_token=? AND status='active'",
    )
      .bind(minimum, now, row.id, token)
      .run();
    const match = reply.cards.find(
      (card) => card.signal === "strong_buy" || card.price <= watch.targetFare,
    );
    if (!match) return;
    if (row.channel === "line_push") {
      triggered = await pushLineAlert(env, deps, row, token, match, now);
      return;
    }
    const subscriptions = await env.DB.prepare(
      "SELECT endpoint,p256dh,auth FROM web_push_subscriptions WHERE user_id=?",
    )
      .bind(row.user_id)
      .all<{ endpoint: string; p256dh: string; auth: string }>();
    const user = await env.DB.prepare("SELECT language FROM users WHERE id=?")
      .bind(row.user_id)
      .first<{ language: string }>();
    if (!user) return;
    const payload = {
      title: user.language === "en" ? "Flight Radar · Price drop" : "航班雷達 · 降價通知",
      body: `${watch.intent.origin} → ${watch.intent.destination} · ${formatAmount(match.price, watch.intent.currency)}`,
      url: `/travel?${intentToQuery(watch.intent)}`,
    };
    for (const subscription of subscriptions.results) {
      // Cancellation/account deletion wins before any external notification starts.
      if (
        !(await env.DB.prepare(
          "SELECT id FROM flight_price_watches WHERE id=? AND status='active' AND claim_token=?",
        )
          .bind(row.id, token)
          .first())
      )
        break;
      try {
        const parsed = pushSubscriptionSchema.parse({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        });
        const status = await (deps.webPushSender ?? sendWebPush)(parsed, payload, env, now);
        if (status === 404 || status === 410)
          await env.DB.prepare("DELETE FROM web_push_subscriptions WHERE endpoint=? AND user_id=?")
            .bind(subscription.endpoint, row.user_id)
            .run();
        if (status >= 200 && status < 300) triggered = true;
      } catch {
        /* Keep an undelivered watch active for the next check. */
      }
    }
  } catch (error) {
    // Source/configuration failures do not complete the watch.
    logWatchFailure(error);
  } finally {
    await env.DB.prepare(
      "UPDATE flight_price_watches SET status=CASE WHEN ? THEN 'triggered' ELSE status END,claim_token=NULL,claim_until=0 WHERE id=? AND claim_token=? AND status='active'",
    )
      .bind(triggered ? 1 : 0, row.id, token)
      .run();
  }
}

/** One sprout-free Flex alert; at the monthly cap nothing is sent and the in-app badge remains. */
async function pushLineAlert(
  env: Bindings,
  deps: AppDeps,
  row: WatchRow,
  token: string,
  match: FlightCard,
  now: number,
): Promise<boolean> {
  const to = await lineUserIdOf(env.DB, row.user_id);
  if (to === null) return false;
  // Cancellation/account deletion wins before any external notification starts.
  const claimed = await env.DB.prepare(
    "SELECT id FROM flight_price_watches WHERE id=? AND status='active' AND claim_token=?",
  )
    .bind(row.id, token)
    .first();
  if (!claimed) return false;
  if (!(await reserveLinePush(env.DB, now))) return true;
  try {
    await deps.lineReplyClient(env).push(
      to,
      [
        {
          type: "flex",
          altText: `航班雷達 · 降價通知 ${match.intent.origin} → ${match.intent.destination} · ${formatAmount(match.price, match.intent.currency)}`,
          contents: { type: "carousel", contents: [flightBubble(match)] },
        },
      ],
      await retryKeyOf(row.id),
    );
    return true;
  } catch (error) {
    // Only a definite 4xx proves nothing was sent; a timeout, network error or 5xx may have gone out.
    if (error instanceof LinePushRejectedError) await releaseLinePush(env.DB, now);
    return false;
  }
}

/** A UUID derived from the watch id, so every retry of one watch's alert shares one LINE retry key. */
async function retryKeyOf(watchId: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`flight-watch:${watchId}`)),
  );
  digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x40; // version 4 layout
  digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(digest.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
