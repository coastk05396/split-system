import { flightHighlights } from "./history.js";
import {
  currencyCodeSchema,
  flightAdviceRequestSchema,
  flightSearchRequestSchema,
  flightRecipes,
} from "@split/shared";
import { createDb } from "../db/client.js";
import { consumeRateLimit } from "../rate-limit.js";
import { adviseFlights } from "./advice.js";
import { Hono } from "hono";
import type { AppEnv } from "../api.js";
import { requireUser } from "../auth/require-user.js";
import type { AppDeps } from "../deps.js";
import { parseBody } from "../request-guards.js";
import { ApiError } from "../errors.js";
import { searchFlightRequest } from "./search.js";

export function flightRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .get("/flights/highlights", requireUser(deps.now), async (c) => {
      const currency = currencyCodeSchema.safeParse(c.req.query("currency") ?? "TWD");
      if (!currency.success) throw new ApiError("VALIDATION_FAILED");
      return c.json(
        {
          highlights: await flightHighlights(c.env.DB, currency.data, deps.now()),
          recipes: flightRecipes(deps.now(), currency.data),
        },
        200,
      );
    })
    .post("/flights/search", requireUser(deps.now), async (c) => {
      const request = await parseBody(c, flightSearchRequestSchema);
      return c.json(await searchFlightRequest(c.env, deps, c.var.userId, request), 200);
    })
    .post("/flights/advise", requireUser(deps.now), async (c) => {
      const request = await parseBody(c, flightAdviceRequestSchema);
      await consumeRateLimit(createDb(c.env.DB), c.var.userId, "flights_advise", deps.now());
      return c.json(await adviseFlights(c.env, deps, request), 200);
    });
}
