import { createFlightWatchSchema, pushSubscriptionSchema } from "@split/shared";
import { Hono } from "hono";
import type { AppEnv } from "../api.js";
import { requireUser } from "../auth/require-user.js";
import type { AppDeps } from "../deps.js";
import { ApiError } from "../errors.js";
import { parseBody } from "../request-guards.js";
import { linePushHasQuota, lineUserIdOf } from "./line-push.js";
import { createFlightWatch, expireWatches, watchFromRow, type WatchRow } from "./watches.js";

export function flightWatchRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .use("/flights/*", requireUser(deps.now), async (c, next) => {
      if (!(await c.env.DB.prepare("SELECT id FROM users WHERE id=?").bind(c.var.userId).first()))
        throw new ApiError("UNAUTHORIZED");
      await next();
    })
    .get("/flights/vapid-public-key", (c) => c.json({ publicKey: c.env.VAPID_PUBLIC_KEY ?? null }))
    .get("/flights/line-push", async (c) =>
      // Available: a linked LINE Identity and room left in this month's push allowance.
      c.json({
        available:
          (await lineUserIdOf(c.env.DB, c.var.userId)) !== null &&
          (await linePushHasQuota(c.env.DB, deps.now())),
      }),
    )
    .get("/flights/watches", async (c) => {
      await expireWatches(c.env.DB, deps.now());
      const rows = await c.env.DB.prepare(
        "SELECT * FROM flight_price_watches WHERE user_id=? AND status IN ('active','triggered') ORDER BY created_at DESC LIMIT 50",
      )
        .bind(c.var.userId)
        .all<WatchRow>();
      return c.json({ watches: rows.results.map(watchFromRow) });
    })
    .post("/flights/watches", async (c) =>
      c.json(
        await createFlightWatch(
          c.env,
          c.var.userId,
          await parseBody(c, createFlightWatchSchema),
          deps.now(),
        ),
        201,
      ),
    )
    .delete("/flights/watches/:id", async (c) => {
      const result = await c.env.DB.prepare(
        "UPDATE flight_price_watches SET status='cancelled',claim_token=NULL,claim_until=0 WHERE id=? AND user_id=? AND status IN ('active','triggered')",
      )
        .bind(c.req.param("id"), c.var.userId)
        .run();
      if (!result.meta.changes) throw new ApiError("NOT_FOUND");
      return c.body(null, 204);
    })
    .post("/flights/push-subscriptions", async (c) => {
      const subscription = await parseBody(c, pushSubscriptionSchema);
      try {
        const key = Uint8Array.from(
          atob(subscription.keys.p256dh.replace(/-/g, "+").replace(/_/g, "/")),
          (x) => x.charCodeAt(0),
        );
        await crypto.subtle.importKey("raw", key, { name: "ECDH", namedCurve: "P-256" }, false, []);
      } catch {
        throw new ApiError("VALIDATION_FAILED");
      }
      const saved = await c.env.DB.prepare(
        "INSERT INTO web_push_subscriptions(endpoint,user_id,p256dh,auth,created_at) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM web_push_subscriptions WHERE user_id=?)<10 OR EXISTS(SELECT 1 FROM web_push_subscriptions WHERE endpoint=?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth,created_at=excluded.created_at",
      )
        .bind(
          subscription.endpoint,
          c.var.userId,
          subscription.keys.p256dh,
          subscription.keys.auth,
          deps.now(),
          c.var.userId,
          subscription.endpoint,
        )
        .run();
      if (!saved.meta.changes) throw new ApiError("FLIGHT_WATCH_LIMIT");
      return c.body(null, 204);
    });
}
