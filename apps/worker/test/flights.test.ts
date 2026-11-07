import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { productionDeps } from "../src/deps.js";
import { bearer, clock, json, signIn, uniqueSub } from "./auth-harness.js";
import type { FlightSearchReply } from "@split/shared";

describe("Flight Radar HTTP", () => {
  it("returns grounded cards and shares cached fares without carrying another user's budget", async () => {
    let calls = 0;
    const app = createApp({
      ...productionDeps,
      now: () => clock.now,
      flightSource: () => {
        calls++;
        return Promise.resolve([
          {
            price: 7000,
            airline: "Test Air",
            outboundDeparture: "08:00",
            outboundArrival: "12:00",
            inboundDeparture: null,
            inboundArrival: null,
            stops: 0,
            durationMinutes: 180,
            priceLevel: "low",
          },
        ]);
      },
    });
    const user = await signIn("google", uniqueSub("flight"));
    const intent = {
      origin: "TPE",
      destination: "NRT",
      departureDate: "2026-12-04",
      returnDate: "2026-12-07",
      currency: "TWD",
    };
    const search = (body: unknown) =>
      app.request(
        "https://split.test/api/v1/flights/search",
        json(body, bearer(user.accessToken)),
        env,
      );
    const first = await search(intent);
    expect(first.status).toBe(200);
    expect(await first.json<FlightSearchReply>()).toMatchObject({
      degraded: false,
      cards: Array.from({ length: 3 }, () => ({
        price: 7000,
        signal: "strong_buy",
        overBudget: 0,
      })),
    });
    const second = await search({ ...intent, budget: 6000 });
    expect(await second.json<FlightSearchReply>()).toMatchObject({
      cards: Array.from({ length: 3 }, () => ({ signal: "hold", overBudget: 1000 })),
    });
    expect(calls).toBe(3);
  });
});

it("rejects past departures before reaching the source", async () => {
  let calls = 0;
  const app = createApp({
    ...productionDeps,
    now: () => clock.now,
    flightSource: () => {
      calls++;
      return Promise.resolve([]);
    },
  });
  const user = await signIn("google", uniqueSub("past-flight"));
  const response = await app.request(
    "https://split.test/api/v1/flights/search",
    json(
      {
        origin: "TPE",
        destination: "LAX",
        departureDate: "2024-01-01",
        returnDate: "2024-01-05",
        currency: "TWD",
      },
      bearer(user.accessToken),
    ),
    env,
  );
  expect(response.status).toBe(400);
  expect(calls).toBe(0);
});

it("degrades blocked sources to deterministic route/date links and refreshes expired cache", async () => {
  let calls = 0;
  let now = clock.now;
  const app = createApp({
    ...productionDeps,
    now: () => now,
    flightSource: () => {
      calls++;
      return Promise.reject(new Error("consent wall"));
    },
  });
  const user = await signIn("google", uniqueSub("blocked-flight"));
  const intent = {
    origin: "KHH",
    destination: "NRT",
    departureDate: "2026-11-03",
    returnDate: "2026-11-07",
    currency: "TWD",
  };
  const request = () =>
    app.request(
      "https://split.test/api/v1/flights/search",
      json(intent, bearer(user.accessToken)),
      env,
    );
  const response = await request();
  expect(response.status).toBe(200);
  const reply = await response.json<FlightSearchReply>();
  expect(reply).toMatchObject({ degraded: true, cards: [] });
  expect(reply.url).toContain("?tfs=");
  expect(calls).toBe(3);
  now += 30 * 60_000;
  await request();
  expect(calls).toBe(6);
});

it("enforces both minute and hour limits, including cached requests", async () => {
  let now = clock.now;
  let calls = 0;
  const app = createApp({
    ...productionDeps,
    now: () => now,
    flightSource: () => {
      calls++;
      return Promise.resolve([
        {
          price: 5000,
          airline: "Test",
          outboundDeparture: "08:00",
          outboundArrival: "12:00",
          inboundDeparture: null,
          inboundArrival: null,
          stops: 0,
          durationMinutes: 120,
          priceLevel: "typical",
        },
      ]);
    },
  });
  const user = await signIn("google", uniqueSub("limit-flight"));
  const intent = {
    origin: "RMQ",
    destination: "HND",
    departureDate: "2026-12-01",
    returnDate: "2026-12-05",
    currency: "USD",
  };
  const request = () =>
    app.request(
      "https://split.test/api/v1/flights/search",
      json(intent, bearer(user.accessToken)),
      env,
    );
  for (let minute = 0; minute < 4; minute++) {
    for (let i = 0; i < 10; i++) expect((await request()).status).toBe(200);
    if (minute === 0) {
      const blocked = await request();
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("Retry-After")).toBeTruthy();
    }
    now += 60_000;
  }
  const blocked = await request();
  expect(blocked.status).toBe(429);
  expect(await blocked.json()).toEqual({ error: { code: "RATE_LIMITED" } });
  expect(calls).toBe(3);
});

it.each([
  ["unparseable JSON", "{not json"],
  ["an old-schema row", JSON.stringify([{ price: 1 }])],
])("falls back to a live lookup when the cached row is %s", async (_name, response) => {
  const user = await signIn("google", uniqueSub("corrupt-cache"));
  let live = 0;
  const app = createApp({
    ...productionDeps,
    now: () => clock.now,
    flightSource: () => {
      live++;
      return Promise.resolve([
        {
          price: 6543,
          airline: "Live Air",
          outboundDeparture: "08:00",
          outboundArrival: "11:00",
          inboundDeparture: null,
          inboundArrival: null,
          stops: 0,
          durationMinutes: 180,
          priceLevel: "typical" as const,
        },
      ]);
    },
  });
  const search = () =>
    app.request(
      "https://split.test/api/v1/flights/search",
      json(
        {
          origin: "TPE",
          destination: "BKK",
          departureDate: "2026-12-04",
          returnDate: "2026-12-07",
          currency: "TWD",
        },
        bearer(user.accessToken),
      ),
      env,
    );
  await search();
  const warm = live;
  await env.DB.prepare("UPDATE flight_search_cache SET response=?").bind(response).run();

  const res = await search();

  expect(res.status).toBe(200);
  expect(live).toBeGreaterThan(warm);
  const { cards } = await res.json<FlightSearchReply>();
  expect(cards.length).toBeGreaterThan(0);
  expect(cards.every((card) => card.price === 6543)).toBe(true);
});
