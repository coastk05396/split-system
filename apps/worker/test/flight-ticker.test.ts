import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import type { FlightTickerReply } from "@split/shared";
import { createApp } from "../src/app.js";
import { productionDeps } from "../src/deps.js";
import { bearer, clock, signIn, uniqueSub } from "./auth-harness.js";

const DAY = 86_400_000;
const isoDay = (offset: number) => new Date(clock.now + offset * DAY).toISOString().slice(0, 10);
let sourceCalls = 0;
const app = createApp({
  ...productionDeps,
  now: () => clock.now,
  snapshotDestinations: [],
  flightSource: () => {
    sourceCalls++;
    return Promise.reject(new Error("the ticker must not call the source"));
  },
});
const snapshot = (destination: string, currency: string, offset: number, price: number) =>
  env.DB.prepare(
    "INSERT INTO flight_fare_snapshots(origin,destination,currency,departure_date,price,fetched_at) VALUES('TPE',?,?,?,?,?)",
  ).bind(destination, currency, isoDay(offset), price, clock.now);
const history = (destination: string, days: number, price: number) =>
  Array.from({ length: days }, (_, i) =>
    env.DB.prepare(
      "INSERT INTO flight_fare_history(origin,destination,currency,advance_window,observed_day,price,card_json) VALUES('TPE',?,'TWD','0-14',?,?,'{}')",
    ).bind(destination, isoDay(-(i + 1)), price),
  );
const get = async (query: string, token?: string) =>
  app.request(
    `https://split.test/api/v1/flights/ticker?${query}`,
    token ? { headers: bearer(token) } : {},
    env,
  );

it("lists the cheapest saved fare per destination, with -N% only where mature history exists, and never calls the source", async () => {
  const user = await signIn("google", uniqueSub("ticker"));
  await env.DB.batch([
    snapshot("NRT", "TWD", 3, 9000),
    snapshot("NRT", "TWD", 5, 6500),
    snapshot("OKA", "TWD", 4, 8000),
    snapshot("KIX", "TWD", 6, 7000),
    snapshot("KIX", "USD", 6, 100),
    snapshot("HKG", "TWD", -2, 1000),
    ...history("OKA", 14, 10000),
    ...history("NRT", 3, 20000),
  ]);
  const res = await get("origin=TPE&currency=TWD", user.accessToken);
  expect(res.status).toBe(200);
  // Cheapest first; OKA is 20% under its 14-day mean, NRT has too little history, KIX none.
  expect(await res.json<FlightTickerReply>()).toEqual({
    chips: [
      { destination: "NRT", price: 6500 },
      { destination: "KIX", price: 7000 },
      { destination: "OKA", price: 8000, percentBelow: 20 },
    ],
  });
  expect(sourceCalls).toBe(0);
});

it("is empty without snapshots, needs a signed-in User and rejects bad input", async () => {
  const user = await signIn("google", uniqueSub("ticker-bad"));
  expect(await (await get("origin=SIN&currency=TWD", user.accessToken)).json()).toEqual({
    chips: [],
  });
  expect((await get("origin=TPE&currency=TWD")).status).toBe(401);
  expect((await get("origin=bad&currency=TWD", user.accessToken)).status).toBe(400);
});
