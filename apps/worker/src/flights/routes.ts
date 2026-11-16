import { buildTripComUrl, flightGoQuerySchema } from "@split/shared";
import { Hono } from "hono";
import type { AppEnv } from "../api.js";
import { createDb } from "../db/client.js";
import type { AppDeps } from "../deps.js";
import { ApiError } from "../errors.js";
import { listDailyFlights } from "./daily.js";

/**
 * Public daily cheap flights routes (`/api/v1/flights/*`):
 * - `GET /flights/daily`: lists verified daily deals (with fallback to curated deals).
 * - `GET /flights/go`: validates query params and 302-redirects to bilingual Trip.com.
 */
export function flightRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .get("/flights/daily", async (c) => {
      const data = await listDailyFlights(createDb(c.env.DB), deps.now());
      return c.json(data, 200);
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
      const targetUrl = buildTripComUrl(parsed.data, {
        allianceId: c.env.TRIP_COM_ALLIANCE_ID,
        sid: c.env.TRIP_COM_SID,
      });
      c.header("Cache-Control", "no-store");
      return c.redirect(targetUrl, 302);
    });
}
