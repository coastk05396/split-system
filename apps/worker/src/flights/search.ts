import { ApiError } from "../errors.js";
import { productionFlightAI } from "./ai.js";
import { loadFareHistory, recordFareHistory } from "./history.js";
import {
  googleFlightsUrl,
  evaluateDealSignal,
  flightCandidates,
  flightSearchIntentSchema,
  type FlightSearchRequest,
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
  return executeFlightSearch(env, deps, intent);
}

/** Prompt parsing happens only after quota checks; structured edits bypass it completely. */
export async function searchFlightRequest(
  env: Bindings,
  deps: AppDeps,
  userId: string,
  request: FlightSearchRequest,
): Promise<FlightSearchReply> {
  if (!("prompt" in request)) return searchFlights(env, deps, userId, request);
  const now = deps.now();
  const db = createDb(env.DB);
  await consumeRateLimit(db, userId, "flights_minute", now);
  await consumeRateLimit(db, userId, "flights_hour", now);
  const intent = flightSearchIntentSchema.parse(
    await (deps.flightAI ?? productionFlightAI).parsePrompt(
      request.prompt,
      request.defaults ?? {},
      env,
      now,
    ),
  );
  return executeFlightSearch(env, deps, intent);
}

export async function executeFlightSearch(
  env: Bindings,
  deps: AppDeps,
  intent: FlightSearchIntent,
): Promise<FlightSearchReply> {
  const today = new Date(deps.now()).toISOString().slice(0, 10);
  if (intent.departureDate < today) throw new ApiError("VALIDATION_FAILED");
  const candidates = flightCandidates(intent).filter(
    (candidate) => candidate.departureDate >= today,
  );
  const replies = await Promise.all(
    candidates.map(async (candidate) => {
      const { fares, degraded } = await lookupFares(env, deps, candidate);
      return buildFlightReply(env, candidate, fares, degraded, deps.now());
    }),
  );
  const cards = replies
    .flatMap((reply) => reply.cards)
    .sort(
      (a, b) =>
        ({ strong_buy: 0, buy: 1, hold: 2 })[a.signal] -
          { strong_buy: 0, buy: 1, hold: 2 }[b.signal] || a.price - b.price,
    );
  return {
    intent,
    cards,
    degraded: cards.length === 0 || replies.some((reply) => reply.degraded),
    url: googleFlightsUrl(intent),
  };
}

/** Shared source/cache lookup for user searches and scheduled route/watch refreshes. */
export async function lookupFares(
  env: Bindings,
  deps: AppDeps,
  intent: FlightSearchIntent,
): Promise<{ fares: FlightFare[]; degraded: boolean }> {
  const now = deps.now();
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
      fares = z
        .array(flightFareSchema)
        .max(20)
        .parse(fares)
        .filter((fare) => fareMatchesIntent(fare, intent));
      await recordFareHistory(env.DB, intent, fares, now);
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
  return { fares: fares.filter((fare) => fareMatchesIntent(fare, intent)), degraded };
}

export async function buildFlightReply(
  env: Bindings,
  intent: FlightSearchIntent,
  fares: FlightFare[],
  degraded: boolean,
  now: number,
): Promise<FlightSearchReply> {
  const url = googleFlightsUrl(intent);
  const history = await loadFareHistory(env.DB, intent, now);
  const cards = fares
    .map((fare) => ({
      ...fare,
      intent,
      ...evaluateDealSignal({
        price: fare.price,
        priceLevel: fare.priceLevel,
        ...(intent.budget === undefined ? {} : { budget: intent.budget }),
        history,
      }),
      url,
    }))
    .sort(
      (a, b) =>
        ({ strong_buy: 0, buy: 1, hold: 2 })[a.signal] -
          { strong_buy: 0, buy: 1, hold: 2 }[b.signal] || a.price - b.price,
    );
  return { intent, cards, degraded: degraded || cards.length === 0, url };
}

/** Check source facts once for searches, scheduled snapshots and Price Watches alike. */
export function fareMatchesIntent(fare: FlightFare, intent: FlightSearchIntent): boolean {
  if (intent.directOnly && fare.stops !== 0) return false;
  if (!intent.excludeRedEye) return true;
  return [fare.outboundDeparture, fare.inboundDeparture].every((time) => {
    if (time === null) return true;
    const hour = Number(/(?:T|^)(\d{2}):/.exec(time)?.[1]);
    return Number.isFinite(hour) && hour >= 6 && hour < 22;
  });
}
