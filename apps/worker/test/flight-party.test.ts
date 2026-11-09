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

it("refuses infants beyond the adults, unknown cabins and parties over nine", async () => {
  const { search } = await harness("party-invalid");
  for (const bad of [
    { adults: 0 },
    { adults: 6, children: 4 },
    { adults: 1, infants: 2 },
    { adults: 5, children: 3, infants: 2 },
    { cabin: "coach" },
  ]) {
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

it("hands infants to the source and the Google link, caches them apart and never multiplies the fare", async () => {
  const { seen, search } = await harness("party-infants");
  const response = await search({ adults: 2, infants: 1 });
  expect(response.status).toBe(200);
  const reply = await response.json<FlightSearchReply>();
  expect(seen[0]).toMatchObject({ adults: 2, infants: 1 });
  expect(reply.intent.infants).toBe(1);
  expect(reply.cards[0]?.price).toBe(fare.price);
  const tfs = new URL(reply.url).searchParams.get("tfs") ?? "";
  const bytes = Array.from(atob(tfs.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  expect(bytes.slice(-11)).toEqual([72, 1, 64, 1, 64, 1, 64, 4, 152, 1, 1]);
  await search({ adults: 2, infants: 1 });
  expect(seen).toHaveLength(3); // the repeat is cached
  await search({ adults: 2, infants: 2 });
  expect(seen).toHaveLength(6); // another infant count is a different key
});

it("keeps an infant on a 1-adult search in the fare history: the source price excludes them", async () => {
  const { search } = await harness("party-infants-history");
  await search({ infants: 1 });
  expect(await stored()).toBeGreaterThan(0);
});
