import { buildTripComUrl, flightGoQuerySchema, type TripComAffiliateConfig } from "@split/shared";
import { Hono } from "hono";
import type { AppEnv } from "../api.js";
import type { Bindings } from "../env.js";
import { createDb } from "../db/client.js";
import type { AppDeps } from "../deps.js";
import { ApiError } from "../errors.js";
import { listDailyFlights } from "./daily.js";

const affiliateFrom = (env: Bindings): TripComAffiliateConfig => ({
  allianceId: env.TRIP_COM_ALLIANCE_ID,
  sid: env.TRIP_COM_SID,
  sub3: env.TRIP_COM_SUB3,
});

/**
 * Public daily cheap flights routes (`/api/v1/flights/*`):
 * - `GET /flights/daily`: lists verified daily deals (with fallback to curated deals) and the
 *   public affiliate parameters, so LINE can open Trip.com directly (ADR 0015).
 * - `GET /flights/go`: validates query params and 302-redirects to bilingual Trip.com.
 */
export function flightRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .get("/flights/daily", async (c) => {
      const data = await listDailyFlights(createDb(c.env.DB), deps.now());
      return c.json({ ...data, affiliate: affiliateFrom(c.env) }, 200);
    })
    .get("/flights/go", (c) => {
      const parsed = flightGoQuerySchema.safeParse(c.req.query());
      if (!parsed.success) {
        throw new ApiError("VALIDATION_FAILED", {
          issues: parsed.error.issues.map((i) => ({
            path: i.path.map(String),
            message: i.message,
          })),
        });
      }
      const targetUrl = buildTripComUrl(parsed.data, affiliateFrom(c.env));
      c.header("Cache-Control", "no-store");
      return c.redirect(targetUrl, 302);
    });
}
