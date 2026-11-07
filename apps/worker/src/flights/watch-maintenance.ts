import { formatAmount, pushSubscriptionSchema } from "@split/shared";
import type { AppDeps } from "../deps.js";
import type { Bindings } from "../env.js";
import { buildFlightReply, lookupFares } from "./search.js";
import { expireWatches, watchFromRow, type WatchRow } from "./watches.js";
import { sendWebPush } from "./web-push.js";

export async function maintainFlightWatches(env: Bindings, deps: AppDeps): Promise<void> {
  const now = deps.now();
  await expireWatches(env.DB, now);
  const watches = await env.DB.prepare(
    "SELECT * FROM flight_price_watches WHERE status='active' AND channel='web_push' AND claim_until<? ORDER BY COALESCE(checked_at,0),created_at",
  )
    .bind(now)
    .all<WatchRow>();
  for (const row of watches.results) {
    const token = crypto.randomUUID();
    const claimed = await env.DB.prepare(
      "UPDATE flight_price_watches SET claim_token=?,claim_until=? WHERE id=? AND status='active' AND claim_until<?",
    )
      .bind(token, now + 5 * 60_000, row.id, now)
      .run();
    if (!claimed.meta.changes) continue;
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
      if (!match) continue;
      const subscriptions = await env.DB.prepare(
        "SELECT endpoint,p256dh,auth FROM web_push_subscriptions WHERE user_id=?",
      )
        .bind(row.user_id)
        .all<{ endpoint: string; p256dh: string; auth: string }>();
      const user = await env.DB.prepare("SELECT language FROM users WHERE id=?")
        .bind(row.user_id)
        .first<{ language: string }>();
      if (!user) continue;
      const payload = {
        title: user.language === "en" ? "Flight Radar · Price drop" : "航班雷達 · 降價通知",
        body: `${watch.intent.origin} → ${watch.intent.destination} · ${formatAmount(match.price, watch.intent.currency)}`,
        url: `/travel?intent=${encodeURIComponent(JSON.stringify(watch.intent))}`,
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
            await env.DB.prepare(
              "DELETE FROM web_push_subscriptions WHERE endpoint=? AND user_id=?",
            )
              .bind(subscription.endpoint, row.user_id)
              .run();
          if (status >= 200 && status < 300) triggered = true;
        } catch {
          /* Keep an undelivered watch active for the next check. */
        }
      }
    } catch {
      /* Source/configuration failures do not complete the watch. */
    } finally {
      await env.DB.prepare(
        "UPDATE flight_price_watches SET status=CASE WHEN ? THEN 'triggered' ELSE status END,claim_token=NULL,claim_until=0 WHERE id=? AND claim_token=? AND status='active'",
      )
        .bind(triggered ? 1 : 0, row.id, token)
        .run();
    }
  }
}
