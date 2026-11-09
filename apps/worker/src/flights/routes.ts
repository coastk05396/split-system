import { fareTicker, flightHighlights } from "./history.js";
import { z } from "zod";
import {
  airportCodeSchema,
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

const priceStripQuerySchema = z.object({
  origin: airportCodeSchema,
  destination: airportCodeSchema,
  currency: currencyCodeSchema,
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});

const tickerQuerySchema = z.object({ origin: airportCodeSchema, currency: currencyCodeSchema });

export function flightRoutes(deps: AppDeps) {
  return (
    new Hono<AppEnv>()
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
      // Reads stored Fare Snapshots only; it never reaches the flight source (ADR 0007).
      .get("/flights/price-strip", requireUser(deps.now), async (c) => {
        const query = priceStripQuerySchema.safeParse({
          origin: c.req.query("origin"),
          destination: c.req.query("destination"),
          currency: c.req.query("currency"),
          month: c.req.query("month"),
        });
        if (!query.success) throw new ApiError("VALIDATION_FAILED");
        const { origin, destination, currency, month } = query.data;
        const rows = await c.env.DB.prepare(
          "SELECT departure_date, price, fetched_at FROM flight_fare_snapshots WHERE origin=? AND destination=? AND currency=? AND departure_date>=? AND departure_date<? ORDER BY departure_date",
        )
          .bind(origin, destination, currency, `${month}-01`, `${month}-32`)
          .all<{ departure_date: string; price: number; fetched_at: number }>();
        return c.json(
          {
            days: rows.results.map((row) => ({
              date: row.departure_date,
              price: row.price,
              fetchedAt: row.fetched_at,
            })),
          },
          200,
        );
      })
      // Fare Ticker: Fare Snapshots and fare history only; it never reaches the flight source.
      .get("/flights/ticker", requireUser(deps.now), async (c) => {
        const query = tickerQuerySchema.safeParse({
          origin: c.req.query("origin"),
          currency: c.req.query("currency"),
        });
        if (!query.success) throw new ApiError("VALIDATION_FAILED");
        return c.json(await fareTicker(c.env.DB, query.data, deps.now()), 200);
      })
      .post("/flights/search", requireUser(deps.now), async (c) => {
        const request = await parseBody(c, flightSearchRequestSchema);
        return c.json(await searchFlightRequest(c.env, deps, c.var.userId, request), 200);
      })
      .post("/flights/advise", requireUser(deps.now), async (c) => {
        const request = await parseBody(c, flightAdviceRequestSchema);
        await consumeRateLimit(createDb(c.env.DB), c.var.userId, "flights_advise", deps.now());
        return c.json(await adviseFlights(c.env, deps, request), 200);
      })
  );
}
