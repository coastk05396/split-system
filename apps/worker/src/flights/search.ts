import {
  googleFlightsUrl,
  type FlightFare,
  type FlightSearchIntent,
  type FlightSearchReply,
} from "@split/shared";
import { z } from "zod";
import { flightFareSchema } from "@split/shared";
import { createDb } from "../db/client.js";
import type { AppDeps } from "../deps.js";
import type { Bindings } from "../env.js";
import { consumeRateLimit } from "../rate-limit.js";
import { containerFlightSource } from "./source.js";

/** Cache only source facts; budgets and Deal Signals belong to the current search. */
export async function searchFlights(
  env: Bindings,
  deps: AppDeps,
  userId: string,
  intent: FlightSearchIntent,
): Promise<FlightSearchReply> {
  const now = deps.now();
  const db = createDb(env.DB);
  await consumeRateLimit(db, userId, "flights_minute", now);
  await consumeRateLimit(db, userId, "flights_hour", now);
  const { budget: _budget, ...sourceIntent } = intent;
  const key = JSON.stringify(sourceIntent);
  const cached = await env.DB.prepare(
    "SELECT response FROM flight_search_cache WHERE cache_key=? AND expires_at>?",
  )
    .bind(key, now)
    .first<{ response: string }>();
  let fares: FlightFare[];
  let degraded = false;
  if (cached) {
    fares = z.array(flightFareSchema).parse(JSON.parse(cached.response));
  } else {
    try {
      fares = await (deps.flightSource ?? containerFlightSource)(intent, env);
      // The DI port is also a trust boundary: no unvalidated upstream money is displayed.
      fares = z.array(flightFareSchema).max(20).parse(fares);
      await env.DB.prepare(
        "INSERT INTO flight_search_cache(cache_key,response,expires_at) VALUES(?,?,?) ON CONFLICT(cache_key) DO UPDATE SET response=excluded.response,expires_at=excluded.expires_at",
      )
        .bind(key, JSON.stringify(fares), now + 30 * 60_000)
        .run();
    } catch {
      fares = [];
      degraded = true;
    }
  }
  const url = googleFlightsUrl(intent);
  const cards = fares
    .map((fare) => {
      const overBudget = Math.max(0, fare.price - (intent.budget ?? fare.price));
      const signal =
        overBudget > 0 || fare.priceLevel === "high"
          ? "hold"
          : fare.priceLevel === "low"
            ? "strong_buy"
            : fare.priceLevel === "typical"
              ? "buy"
              : "hold";
      return { ...fare, intent, signal, overBudget, url } as const;
    })
    .sort(
      (a, b) =>
        ({ strong_buy: 0, buy: 1, hold: 2 })[a.signal] -
          { strong_buy: 0, buy: 1, hold: 2 }[b.signal] || a.price - b.price,
    );
  return { intent, cards, degraded: degraded || cards.length === 0, url };
}
