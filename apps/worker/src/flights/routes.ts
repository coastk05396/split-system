import { flightSearchIntentSchema } from "@split/shared";
import { Hono } from "hono";
import type { AppEnv } from "../api.js";
import { requireUser } from "../auth/require-user.js";
import type { AppDeps } from "../deps.js";
import { parseBody } from "../request-guards.js";
import { ApiError } from "../errors.js";
import { searchFlights } from "./search.js";

export function flightRoutes(deps: AppDeps) {
  return new Hono<AppEnv>().post("/flights/search", requireUser(deps.now), async (c) => {
    const intent = await parseBody(c, flightSearchIntentSchema);
    if (intent.departureDate < new Date(deps.now()).toISOString().slice(0, 10))
      throw new ApiError("VALIDATION_FAILED");
    return c.json(await searchFlights(c.env, deps, c.var.userId, intent), 200);
  });
}
