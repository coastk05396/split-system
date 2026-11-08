import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { productionDeps } from "../src/deps.js";
import { bearer, clock, json, signIn, uniqueSub } from "./auth-harness.js";
import type { FlightFare, FlightSearchIntent, FlightSearchReply } from "@split/shared";

const fare: FlightFare = {
  price: 21000,
  airline: "Test Air",
  outboundDeparture: "08:00",
  outboundArrival: "12:00",
  inboundDeparture: null,
  inboundArrival: null,
  stops: 0,
  durationMinutes: 180,
  priceLevel: "low",
};
const base = {
  origin: "KHH",
  destination: "CEB",
  departureDate: "2026-12-04",
  returnDate: "2026-12-07",
  currency: "TWD",
};

async function harness(sub: string) {
  const seen: FlightSearchIntent[] = [];
  const app = createApp({
    ...productionDeps,
    now: () => clock.now,
    flightSource: (intent) => {
      seen.push(intent);
      return Promise.resolve([fare]);
    },
  });
  const user = await signIn("google", uniqueSub(sub));
  const search = (body: object) =>
    app.request(
      "https://split.test/api/v1/flights/search",
      json({ ...base, ...body }, bearer(user.accessToken)),
      env,
    );
  return { seen, search };
}
const stored = () =>
  env.DB.prepare("SELECT price FROM flight_fare_history WHERE origin='KHH' AND destination='CEB'")
    .all<{ price: number }>()
    .then((rows) => rows.results.length);

it("hands the party, cabin and trip type to the flight source, and caches each separately", async () => {
  const { seen, search } = await harness("party-source");
  const party = { adults: 2, children: 1, cabin: "business" };
  expect((await search(party)).status).toBe(200);
  await search(party);
  expect(seen).toHaveLength(3); // one source call per candidate date, the repeat is cached
  expect(seen[0]).toMatchObject(party);
  await search({ ...party, cabin: "first" });
  expect(seen).toHaveLength(6);
});

it("accepts a one-way search without a return date and refuses a round trip without one", async () => {
  const { seen, search } = await harness("one-way");
  const response = await search({ returnDate: undefined, tripType: "one-way" });
  expect(response.status).toBe(200);
  const reply = await response.json<FlightSearchReply>();
  expect(reply.cards.length).toBeGreaterThan(0);
  expect(seen[0]?.returnDate).toBeUndefined();
  expect(seen[0]?.tripType).toBe("one-way");
  expect((await search({ returnDate: undefined })).status).toBe(400);
});

it("refuses infants-sized parties, unknown cabins and parties over nine", async () => {
  const { search } = await harness("party-invalid");
  for (const bad of [{ adults: 0 }, { adults: 6, children: 4 }, { cabin: "coach" }]) {
    expect((await search(bad)).status).toBe(400);
  }
});

it("keeps party, cabin and one-way searches out of the fare history", async () => {
  const { search } = await harness("party-history");
  await search({ adults: 2 });
  await search({ cabin: "business" });
  await search({ children: 1 });
  await search({ returnDate: undefined, tripType: "one-way" });
  expect(await stored()).toBe(0);
  await search({});
  expect(await stored()).toBeGreaterThan(0);
});
