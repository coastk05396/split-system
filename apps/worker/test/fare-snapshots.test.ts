import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import type { FlightFare, FlightSearchIntent } from "@split/shared";
import { createApp } from "../src/app.js";
import { productionDeps } from "../src/deps.js";
import { dailyMaintenance } from "../src/maintenance.js";
import { bearer, clock, json, signIn, uniqueSub } from "./auth-harness.js";

const fare = (price: number): FlightFare => ({
  price,
  airline: "Snap Air",
  outboundDeparture: "09:00",
  outboundArrival: "12:00",
  inboundDeparture: null,
  inboundArrival: null,
  stops: 0,
  durationMinutes: 150,
  priceLevel: "low",
});

const events: string[] = [];
const pauses: number[] = [];
function deps(source: (intent: FlightSearchIntent) => Promise<FlightFare[]>) {
  return {
    ...productionDeps,
    now: () => clock.now,
    rateSource: { fetchRate: () => Promise.reject(new Error("offline")) },
    flightSource: (intent: FlightSearchIntent) => {
      events.push("fetch");
      return source(intent);
    },
    pause: (ms: number) => {
      events.push("pause");
      pauses.push(ms);
      return Promise.resolve();
    },
  };
}
const count = () =>
  env.DB.prepare("SELECT count(*) n FROM flight_fare_snapshots").first<{ n: number }>();

it("fills one cheapest-fare snapshot per route and day with its fetch time, spaced and skipping failures", async () => {
  events.length = 0;
  pauses.length = 0;
  const failing = new Date(clock.now + 5 * 86_400_000).toISOString().slice(0, 10);
  await dailyMaintenance(
    env,
    clock.now,
    deps((intent) =>
      intent.departureDate === failing
        ? Promise.reject(new Error("blocked"))
        : Promise.resolve([fare(9000), fare(6500)]),
    ),
  );
  const rows = await env.DB.prepare(
    "SELECT destination, departure_date, price, fetched_at FROM flight_fare_snapshots",
  ).all<{ destination: string; departure_date: string; price: number; fetched_at: number }>();
  // 3 routes x 30 days, minus the failing day on each route.
  expect(rows.results).toHaveLength(87);
  expect(rows.results.every((r) => r.price === 6500 && r.fetched_at === clock.now)).toBe(true);
  expect(rows.results.some((r) => r.departure_date === failing)).toBe(false);
  expect(new Set(rows.results.map((r) => r.destination)).size).toBe(3);

  // From the first snapshot request on, every request follows a pause.
  const tail = events.slice(events.indexOf("pause") - 1);
  expect(tail.every((e, i) => e === (i % 2 === 0 ? "fetch" : "pause"))).toBe(true);
  expect(tail.at(-1)).toBe("fetch");
  expect(Math.min(...pauses)).toBeGreaterThanOrEqual(1000);

  // A second run replaces the day's snapshot instead of adding another.
  await dailyMaintenance(
    env,
    clock.now + 60_000,
    deps(() => Promise.resolve([fare(5000)])),
  );
  expect(await count()).toEqual({ n: 90 });
});

it("never fetches snapshots for a signed-in user's request", async () => {
  const user = await signIn("google", uniqueSub("snapshots"));
  const app = createApp(deps(() => Promise.resolve([fare(7000)])));
  const before = await count();
  const res = await app.request(
    "https://split.test/api/v1/flights/search",
    json(
      {
        origin: "TSA",
        destination: "KIX",
        departureDate: "2026-12-04",
        returnDate: "2026-12-07",
        currency: "TWD",
      },
      bearer(user.accessToken),
    ),
    env,
  );
  expect(res.status).toBe(200);
  expect(await count()).toEqual(before);
});
