import { flightFareSchema, type FlightSearchIntent } from "@split/shared";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import type { Bindings } from "../env.js";
import { fareMatchesIntent } from "./search.js";
import { containerFlightSource } from "./source.js";

const DAY = 86_400_000;
/**
 * Destinations from TPE whose Fare Snapshots are refreshed on every run, so each is at most a day
 * old. 6 routes x 30 days = 180 source requests, about 4.5 minutes of spacing per run.
 */
export const POPULAR_SNAPSHOT_DESTINATIONS = ["NRT", "KIX", "OKA", "ICN", "BKK", "HKG"] as const;
const DAYS_AHEAD = 30;
/** Gap between source requests so Google is not hit in a burst. */
export const SNAPSHOT_SPACING_MS = 1_500;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Scheduled only (never from a user request): refreshes the Fare Snapshots behind the Price Strip.
 * The fixed popular routes, the next 30 days, one date per source request, spaced; a failing date is
 * skipped. The source only does round trips, so a snapshot is the cheapest outbound fare priced
 * for a three-day stay. Does not touch the search cache or the Deal Signal fare history.
 */
export async function maintainFareSnapshots(env: Bindings, deps: AppDeps): Promise<void> {
  const now = deps.now();
  const pause = deps.pause ?? sleep;
  const source = deps.flightSource ?? containerFlightSource;
  await env.DB.prepare("DELETE FROM flight_fare_snapshots WHERE departure_date<?")
    .bind(isoDay(now))
    .run();
  let requested = false;
  for (const destination of POPULAR_SNAPSHOT_DESTINATIONS) {
    for (let d = 1; d <= DAYS_AHEAD; d++) {
      if (requested) await pause(SNAPSHOT_SPACING_MS);
      requested = true;
      const intent: FlightSearchIntent = {
        origin: "TPE",
        destination,
        departureDate: isoDay(now + d * DAY),
        returnDate: isoDay(now + (d + 3) * DAY),
        currency: "TWD",
        excludeRedEye: false,
        directOnly: false,
      };
      try {
        const fares = z
          .array(flightFareSchema)
          .max(20)
          .parse(await source(intent, env))
          .filter((fare) => fareMatchesIntent(fare, intent));
        const cheapest = Math.min(...fares.map((fare) => fare.price));
        if (!Number.isFinite(cheapest)) continue;
        await env.DB.prepare(
          "INSERT INTO flight_fare_snapshots(origin,destination,currency,departure_date,price,fetched_at) VALUES(?,?,?,?,?,?) ON CONFLICT(origin,destination,currency,departure_date) DO UPDATE SET price=excluded.price,fetched_at=excluded.fetched_at",
        )
          .bind(
            intent.origin,
            intent.destination,
            intent.currency,
            intent.departureDate,
            cheapest,
            now,
          )
          .run();
      } catch {
        /* A failing date keeps its older snapshot; the next run retries. */
      }
    }
  }
}
