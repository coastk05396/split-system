import {
  FLIGHT_DESTINATIONS,
  evaluateDealSignal,
  flightFareSchema,
  flightSearchIntentSchema,
  googleFlightsUrl,
  isStandardSearch,
  type FlightCard,
  type FlightFare,
  type FlightSearchIntent,
} from "@split/shared";
import type { AppDeps } from "../deps.js";
import type { Bindings } from "../env.js";
import { z } from "zod";
import { lookupFares } from "./search.js";

const DAY = 86_400_000;
const isoDay = (now: number) => new Date(now).toISOString().slice(0, 10);
export function fareAdvanceWindow(intent: FlightSearchIntent, now: number): string {
  const days = Math.ceil((Date.parse(intent.departureDate) - Date.parse(isoDay(now))) / DAY);
  return days <= 14 ? "0-14" : days <= 30 ? "15-30" : days <= 60 ? "31-60" : "61+";
}

export async function loadFareHistory(
  db: D1Database,
  intent: FlightSearchIntent,
  now: number,
): Promise<number[]> {
  // History is 1 adult economy round trip; comparing another party's total against it would mislead.
  if (!isStandardSearch(intent)) return [];
  const rows = await db
    .prepare(
      "SELECT price FROM flight_fare_history WHERE origin=? AND destination=? AND currency=? AND advance_window=? AND observed_day>=? AND observed_day<=? ORDER BY observed_day",
    )
    .bind(
      intent.origin,
      intent.destination,
      intent.currency,
      fareAdvanceWindow(intent, now),
      isoDay(now - 59 * DAY),
      isoDay(now),
    )
    .all<{ price: number }>();
  return rows.results.map((row) => row.price);
}

/**
 * A repeated search can lower a day's minimum, but can never manufacture another historical day.
 * Only unfiltered searches count: a direct-only or no-red-eye minimum is a different population,
 * and so is any party, cabin or one-way search (source prices are totals for the whole party).
 */
export async function recordFareHistory(
  db: D1Database,
  intent: FlightSearchIntent,
  fares: FlightFare[],
  now: number,
): Promise<void> {
  if (intent.directOnly || intent.excludeRedEye || !isStandardSearch(intent)) return;
  const minimum = fares.reduce<FlightFare | undefined>(
    (best, fare) => (!best || fare.price < best.price ? fare : best),
    undefined,
  );
  if (!minimum) return;
  const { budget: _budget, ...neutralIntent } = intent;
  await db
    .prepare(
      "INSERT INTO flight_fare_history(origin,destination,currency,advance_window,observed_day,price,card_json) VALUES(?,?,?,?,?,?,?) ON CONFLICT(origin,destination,currency,advance_window,observed_day) DO UPDATE SET price=excluded.price,card_json=excluded.card_json WHERE excluded.price<flight_fare_history.price",
    )
    .bind(
      intent.origin,
      intent.destination,
      intent.currency,
      fareAdvanceWindow(intent, now),
      isoDay(now),
      minimum.price,
      JSON.stringify({ fare: minimum, intent: neutralIntent }),
    )
    .run();
}

const storedFare = z.object({ fare: flightFareSchema, intent: flightSearchIntentSchema });
export async function flightHighlights(
  db: D1Database,
  currency: string,
  now: number,
): Promise<FlightCard[]> {
  const rows = await db
    .prepare(
      "SELECT card_json FROM flight_fare_history WHERE observed_day=? AND currency=? ORDER BY price LIMIT 100",
    )
    .bind(isoDay(now), currency)
    .all<{ card_json: string }>();
  const cards = await Promise.all(
    rows.results.map(async (row) => {
      const { fare, intent } = storedFare.parse(JSON.parse(row.card_json));
      if (intent.departureDate < isoDay(now)) return null;
      const signal = evaluateDealSignal({
        price: fare.price,
        priceLevel: fare.priceLevel,
        history: await loadFareHistory(db, intent, now),
      });
      return signal.signal === "strong_buy"
        ? { ...fare, ...signal, intent, url: googleFlightsUrl(intent) }
        : null;
    }),
  );
  return cards.filter((card) => card !== null).slice(0, 12);
}

/** Bounded daily rotation: four catalog routes, one adult economy, one exact future weekend. */
export async function maintainFlightHistory(env: Bindings, deps: AppDeps): Promise<void> {
  const now = deps.now();
  await env.DB.prepare("DELETE FROM flight_fare_history WHERE observed_day<?")
    .bind(isoDay(now - 59 * DAY))
    .run();
  const departure = new Date(now + 14 * DAY);
  departure.setUTCHours(0, 0, 0, 0);
  departure.setUTCDate(departure.getUTCDate() + ((5 - departure.getUTCDay() + 7) % 7));
  const index = Math.floor(now / DAY) * 4;
  await Promise.all(
    Array.from({ length: 4 }, async (_, offset) => {
      const destination = FLIGHT_DESTINATIONS[(index + offset) % FLIGHT_DESTINATIONS.length];
      if (!destination) return;
      const intent: FlightSearchIntent = {
        origin: "TPE",
        destination: destination.airport,
        departureDate: isoDay(departure.getTime()),
        returnDate: isoDay(departure.getTime() + 3 * DAY),
        currency: "TWD",
        excludeRedEye: false,
        directOnly: false,
      };
      try {
        await lookupFares(env, deps, intent);
      } catch {
        /* Next day's rotation retries source failures. */
      }
    }),
  );
}
