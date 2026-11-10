import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { productionDeps } from "../src/deps.js";
import { bearer, clock, json, signIn, uniqueSub } from "./auth-harness.js";
import type { FlightSearchReply, FlightHighlightsReply } from "@split/shared";

it("records daily route minima, hides immature statistics, and returns today's verified highlights", async () => {
  const user = await signIn("google", uniqueSub("history"));
  const app = createApp({
    ...productionDeps,
    pause: () => Promise.resolve(),
    now: () => clock.now,
    flightSource: () =>
      Promise.resolve([
        {
          price: 8000,
          airline: "Test Air",
          outboundDeparture: "08:00",
          outboundArrival: "12:00",
          inboundDeparture: null,
          inboundArrival: null,
          stops: 0,
          durationMinutes: 180,
          priceLevel: "low",
        },
      ]),
  });
  const intent = {
    origin: "TSA",
    destination: "KIX",
    departureDate: "2026-12-04",
    returnDate: "2026-12-07",
    currency: "TWD",
  };
  const result = await app.request(
    "https://split.test/api/v1/flights/search",
    json(intent, bearer(user.accessToken)),
    env,
  );
  expect(await result.json<FlightSearchReply>()).toMatchObject({
    cards: Array.from({ length: 3 }, () => ({ signal: "strong_buy", history: null })),
  });
  const highlights = await app.request(
    "https://split.test/api/v1/flights/highlights?currency=TWD",
    { headers: bearer(user.accessToken) },
    env,
  );
  expect(highlights.status).toBe(200);
  expect(await highlights.json<FlightHighlightsReply>()).toMatchObject({
    highlights: [expect.objectContaining({ price: 8000, signal: "strong_buy", history: null })],
  });
  const rows = await env.DB.prepare(
    "SELECT price FROM flight_fare_history WHERE origin='TSA' AND destination='KIX'",
  ).all<{ price: number }>();
  expect(rows.results).toEqual([{ price: 8000 }]);
});

it("uses fourteen distinct days, ignoring another currency and observations outside sixty days", async () => {
  const user = await signIn("google", uniqueSub("mature-history"));
  const intent = {
    origin: "KHH",
    destination: "CEB",
    departureDate: "2026-12-04",
    returnDate: "2026-12-07",
    currency: "TWD",
  };
  const oldFare = {
    price: 10000,
    airline: "Test",
    outboundDeparture: "08:00",
    outboundArrival: "12:00",
    inboundDeparture: null,
    inboundArrival: null,
    stops: 0,
    durationMinutes: 180,
    priceLevel: "unknown" as const,
  };
  const insert = (day: number, currency: string) =>
    env.DB.prepare(
      "INSERT INTO flight_fare_history(origin,destination,currency,advance_window,observed_day,price,card_json) VALUES('KHH','CEB',?,'61+',?,?,?)",
    ).bind(
      currency,
      new Date(clock.now - day * 86_400_000).toISOString().slice(0, 10),
      10000,
      JSON.stringify({ fare: oldFare, intent }),
    );
  await env.DB.batch([
    ...Array.from({ length: 13 }, (_, i) => insert(i + 1, "TWD")),
    insert(61, "TWD"),
    insert(1, "USD"),
  ]);
  const app = createApp({
    ...productionDeps,
    pause: () => Promise.resolve(),
    now: () => clock.now,
    flightSource: () => Promise.resolve([{ ...oldFare, price: 8000 }]),
  });
  const result = await app.request(
    "https://split.test/api/v1/flights/search",
    json(intent, bearer(user.accessToken)),
    env,
  );
  expect(await result.json()).toMatchObject({
    cards: Array.from({ length: 3 }, () => ({
      signal: "strong_buy",
      history: { days: 14, percentBelowMean: 18.8, percentile: 7.1 },
    })),
  });
});

it("daily maintenance rotates four verified routes and purges history older than sixty days", async () => {
  const { dailyMaintenance } = await import("../src/maintenance.js");
  const calls: string[] = [];
  const filters: boolean[] = [];
  const deps = {
    ...productionDeps,
    pause: () => Promise.resolve(),
    now: () => clock.now,
    rateSource: { fetchRate: () => Promise.reject(new Error("offline")) },
    flightSource: (intent: import("@split/shared").FlightSearchIntent) => {
      calls.push(intent.destination);
      filters.push(intent.directOnly || intent.excludeRedEye);
      return Promise.resolve([
        {
          price: 7777,
          airline: "Cron Air",
          outboundDeparture: "09:00",
          outboundArrival: "12:00",
          inboundDeparture: null,
          inboundArrival: null,
          stops: 0,
          durationMinutes: 150,
          priceLevel: "low" as const,
        },
      ]);
    },
  };
  await dailyMaintenance(env, clock.now, deps);
  // History rotates first; nothing else calls the source.
  expect(calls.slice(0, 4)).toHaveLength(4);
  expect(new Set(calls.slice(0, 4)).size).toBe(4);
  // The 60-day baseline compares unfiltered populations only.
  expect(filters.slice(0, 4)).toEqual([false, false, false, false]);
  const recorded = await env.DB.prepare(
    "SELECT count(*) n FROM flight_fare_history WHERE price=7777",
  ).first<{ n: number }>();
  expect(recorded?.n).toBe(4);
  const old = await env.DB.prepare(
    "SELECT count(*) n FROM flight_fare_history WHERE observed_day<?",
  )
    .bind(new Date(clock.now - 59 * 86_400_000).toISOString().slice(0, 10))
    .first<{ n: number }>();
  expect(old?.n).toBe(0);
  const rows = await env.DB.prepare(
    "SELECT price FROM flight_fare_history WHERE origin='TPE' AND price=7777",
  ).all();
  expect(rows.results).toHaveLength(4);
});

it("records only unfiltered searches in the fare history", async () => {
  const user = await signIn("google", uniqueSub("filtered-history"));
  const app = createApp({
    ...productionDeps,
    pause: () => Promise.resolve(),
    now: () => clock.now,
    flightSource: () =>
      Promise.resolve([
        {
          price: 4321,
          airline: "Test Air",
          outboundDeparture: "08:00",
          outboundArrival: "12:00",
          inboundDeparture: null,
          inboundArrival: null,
          stops: 0,
          durationMinutes: 180,
          priceLevel: "low" as const,
        },
      ]),
  });
  const base = {
    origin: "KHH",
    destination: "MNL",
    departureDate: "2026-12-04",
    returnDate: "2026-12-07",
    currency: "TWD",
  };
  const search = (extra: object) =>
    app.request(
      "https://split.test/api/v1/flights/search",
      json({ ...base, ...extra }, bearer(user.accessToken)),
      env,
    );
  const stored = () =>
    env.DB.prepare("SELECT price FROM flight_fare_history WHERE origin='KHH' AND destination='MNL'")
      .all<{ price: number }>()
      .then((rows) => rows.results.length);

  await search({ directOnly: true });
  await search({ excludeRedEye: true });
  expect(await stored()).toBe(0);

  await search({});
  expect(await stored()).toBeGreaterThan(0);
});
