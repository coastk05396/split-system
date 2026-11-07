import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { productionDeps } from "../src/deps.js";
import { bearer, clock, json, signIn, uniqueSub } from "./auth-harness.js";
import type { FlightSearchIntent } from "@split/shared";

it("parses a prompt once, discovers four theme routes concurrently, and skips parsing for entity edits", async () => {
  let parses = 0;
  let active = 0;
  let parallel = 0;
  const calls: FlightSearchIntent[] = [];
  const app = createApp({
    ...productionDeps,
    now: () => clock.now,
    flightAI: {
      parsePrompt: () => {
        parses++;
        return Promise.resolve({
          origin: "TPE",
          destination: "OKA",
          departureDate: "2026-12-04",
          returnDate: "2026-12-07",
          currency: "TWD",
          theme: "warm_island",
          excludeRedEye: true,
          directOnly: false,
        });
      },
    },
    flightSource: async (intent) => {
      calls.push(intent);
      active++;
      parallel = Math.max(parallel, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return [
        {
          price: 9000,
          airline: "Test Air",
          outboundDeparture: "08:00",
          outboundArrival: "12:00",
          inboundDeparture: null,
          inboundArrival: null,
          stops: 0,
          durationMinutes: 180,
          priceLevel: "low",
        },
      ];
    },
  });
  const user = await signIn("google", uniqueSub("discovery"));
  const search = (body: unknown) =>
    app.request(
      "https://split.test/api/v1/flights/search",
      json(body, bearer(user.accessToken)),
      env,
    );
  const response = await search({ prompt: "下個月暖島四天，不要紅眼" });
  expect(response.status).toBe(200);
  const reply = await response.json<{ intent: FlightSearchIntent; cards: unknown[] }>();
  expect(reply.cards).toHaveLength(4);
  expect(calls.map((call) => call.destination)).toEqual(["OKA", "HKT", "PEN", "DPS"]);
  expect(parallel).toBe(4);
  await search({ ...reply.intent, budget: 8000 });
  expect(parses).toBe(1);
});

it("uses strict GPT-OSS120b extraction and falls back on provider429 without guessing dates", async () => {
  const { createFlightAI } = await import("../src/flights/ai.js");
  const extracted = {
    origin: null,
    destination: "LAX",
    departureDate: null,
    returnDate: null,
    currency: null,
    budget: 15000,
    excludeRedEye: true,
    directOnly: null,
    theme: null,
    timing: "next_month_weekend",
    durationDays: 4,
  };
  const payloads: unknown[] = [];
  let throttled = false;
  let fallbacks = 0;
  const ai = createFlightAI((_input, init) => {
    if (typeof init?.body !== "string") throw new Error("missing JSON request body");
    payloads.push(JSON.parse(init.body));
    return Promise.resolve(
      throttled
        ? new Response("", { status: 429 })
        : Response.json({ choices: [{ message: { content: JSON.stringify(extracted) } }] }),
    );
  });
  const user = await signIn("google", uniqueSub("ai-fallback"));
  const routeApp = createApp({
    ...productionDeps,
    now: () => clock.now,
    flightAI: ai,
    flightSource: () => Promise.resolve([]),
  });
  const bindings = {
    ...env,
    GROQ_API_KEY: crypto.randomUUID(),
    AI: {
      run: () => {
        fallbacks++;
        return Promise.resolve({ response: JSON.stringify(extracted) });
      },
    },
  };
  const search = () =>
    routeApp.request(
      "https://split.test/api/v1/flights/search",
      json(
        { prompt: "next month weekend to LAX for four days", defaults: { currency: "TWD" } },
        bearer(user.accessToken),
      ),
      bindings,
    );
  const first = await search();
  expect(first.status).toBe(200);
  expect(payloads[0]).toMatchObject({
    model: "openai/gpt-oss-120b",
    reasoning_effort: "low",
    response_format: { type: "json_schema", json_schema: { strict: true } },
  });
  expect(await first.json()).toMatchObject({
    intent: {
      destination: "LAX",
      departureDate: "2025-07-04",
      returnDate: "2025-07-07",
      excludeRedEye: true,
    },
  });
  throttled = true;
  expect((await search()).status).toBe(200);
  expect(fallbacks).toBe(1);
});

it("excludes red-eye and connecting fares before they can become verified highlights", async () => {
  const app = createApp({
    ...productionDeps,
    now: () => clock.now,
    flightSource: () =>
      Promise.resolve([
        {
          price: 1000,
          airline: "Night",
          outboundDeparture: "23:00",
          outboundArrival: "03:00",
          inboundDeparture: null,
          inboundArrival: null,
          stops: 0,
          durationMinutes: 180,
          priceLevel: "low",
        },
        {
          price: 2000,
          airline: "Connecting",
          outboundDeparture: "08:00",
          outboundArrival: "12:00",
          inboundDeparture: null,
          inboundArrival: null,
          stops: 1,
          durationMinutes: 180,
          priceLevel: "low",
        },
        {
          price: 3000,
          airline: "Day",
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
  const user = await signIn("google", uniqueSub("filters"));
  const response = await app.request(
    "https://split.test/api/v1/flights/search",
    json(
      {
        origin: "TSA",
        destination: "SDJ",
        departureDate: "2026-12-04",
        returnDate: "2026-12-07",
        currency: "TWD",
        excludeRedEye: true,
        directOnly: true,
      },
      bearer(user.accessToken),
    ),
    env,
  );
  const reply = await response.json<{ cards: { price: number; airline: string }[] }>();
  expect(reply.cards).toHaveLength(3);
  expect(reply.cards.every((card) => card.price === 3000 && card.airline === "Day")).toBe(true);
  const stored = await env.DB.prepare(
    "SELECT price FROM flight_fare_history WHERE origin='TSA' AND destination='SDJ'",
  ).all<{ price: number }>();
  expect(stored.results).toEqual([{ price: 3000 }]);
});
