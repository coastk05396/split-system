import { rateQuerySchema } from "@split/shared";
import { Hono } from "hono";
import type { AppEnv } from "../api.js";
import { requireUser } from "../auth/require-user.js";
import { createDb } from "../db/client.js";
import type { AppDeps } from "../deps.js";
import { ApiError } from "../errors.js";
import { lookupRate } from "./rates.js";

/** `GET /rates?date&base&quote`: the reference Exchange rate the add-Expense form prefills. */
export function rateRoutes(deps: AppDeps) {
  return new Hono<AppEnv>().get("/rates", requireUser(deps.now), async (c) => {
    const query = rateQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      throw new ApiError("VALIDATION_FAILED", {
        issues: query.error.issues.map((i) => ({ path: i.path.map(String), message: i.message })),
      });
    }
    const rate = await lookupRate(createDb(c.env.DB), deps.rateSource, query.data, deps.now());
    return c.json(rate, 200);
  });
}
