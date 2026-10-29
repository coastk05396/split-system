import type { CurrencyCode, Rate } from "@split/shared";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createDb } from "../src/db/client.js";
import { fxRates } from "../src/db/schema.js";
import { silentReplyClient } from "../src/line/reply-client.js";
import type { FetchedRate, RateSource } from "../src/rates/rate-source.js";
import { refreshRates } from "../src/rates/rates.js";
import { bearer, clock, fakeVerifier, signIn, uniqueSub } from "./auth-harness.js";

/** A rate source the test steers: answers from `answer`, or fails while `down`. */
function fakeSource() {
  const state = {
    calls: [] as { date: string; base: CurrencyCode; quote: CurrencyCode }[],
    down: false,
    answer: (date: string): FetchedRate => ({ rateDate: date, rateScaled: 31_523_400 }),
  };
  const source: RateSource = {
    fetchRate(date, base, quote) {
      state.calls.push({ date, base, quote });
      return state.down ? Promise.reject(new Error("down")) : Promise.resolve(state.answer(date));
    },
  };
  return { state, source };
}

async function setup() {
  const fake = fakeSource();
  const app = createApp({
    verifier: () => fakeVerifier,
    now: () => clock.now,
    rateSource: fake.source,
    lineReplyClient: () => silentReplyClient,
  });
  const session = await signIn("google", uniqueSub("rates"));
  const get = (query: string) =>
    Promise.resolve(
      app.request(
        `https://split.test/api/v1/rates?${query}`,
        { headers: bearer(session.accessToken) },
        env,
      ),
    );
  return { ...fake, get };
}

// The fx_rates cache is shared by the tests in this file, so each test uses its own dates.
describe("GET /rates", () => {
  it("fetches a missing day once, then answers from the D1 cache", async () => {
    const { state, get } = await setup();

    const first = await get("date=2025-03-03&base=USD&quote=TWD");
    const second = await get("date=2025-03-03&base=USD&quote=TWD");

    expect(first.status).toBe(200);
    expect(await first.json<Rate>()).toEqual({
      base: "USD",
      quote: "TWD",
      rateScaled: 31_523_400,
      rateDate: "2025-03-03",
      stale: false,
    });
    expect(await second.json<Rate>()).toMatchObject({ rateScaled: 31_523_400 });
    expect(state.calls).toEqual([{ date: "2025-03-03", base: "USD", quote: "TWD" }]);
  });

  it("uses the last day before a weekend and does not ask again for that weekend day", async () => {
    const { state, get } = await setup();
    state.answer = () => ({ rateDate: "2025-04-04", rateScaled: 32_000_000 });

    // Asked long after Saturday 2025-04-05 ended, so the source has nothing newer for it.
    const res = await get("date=2025-04-05&base=USD&quote=TWD");
    await get("date=2025-04-05&base=USD&quote=TWD");

    expect(await res.json<Rate>()).toMatchObject({
      rateDate: "2025-04-04",
      rateScaled: 32_000_000,
    });
    expect(state.calls).toHaveLength(1);
  });

  it("asks again, at most hourly, for a day the source has not published yet", async () => {
    const today = new Date(clock.now).toISOString().slice(0, 10);
    const first = await setup();
    first.state.answer = () => ({ rateDate: "2025-06-13", rateScaled: 30_000_000 });
    await first.get(`date=${today}&base=USD&quote=TWD`);
    await first.get(`date=${today}&base=USD&quote=TWD`);
    expect(first.state.calls).toHaveLength(1);

    clock.now += 2 * 3_600_000;
    const later = await setup();
    const res = await later.get(`date=${today}&base=USD&quote=TWD`);
    expect(later.state.calls).toHaveLength(1);
    expect(await res.json<Rate>()).toMatchObject({ rateDate: today, rateScaled: 31_523_400 });
  });

  it("serves the newest cached rate as stale when every source is down", async () => {
    const { state, get } = await setup();
    await get("date=2025-05-05&base=TWD&quote=USD");
    state.down = true;

    // A day after "now" that the cache cannot know about yet.
    const res = await get("date=2099-01-01&base=TWD&quote=USD");

    expect(res.status).toBe(200);
    expect(await res.json<Rate>()).toMatchObject({ rateDate: "2025-05-05", stale: true });
  });

  it("answers 503 RATE_UNAVAILABLE when the sources are down and nothing is cached", async () => {
    const { state, get } = await setup();
    await createDb(env.DB).delete(fxRates);
    state.down = true;
    const res = await get("date=2025-05-06&base=USD&quote=TWD");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: { code: "RATE_UNAVAILABLE" } });
  });

  it("gives 1 for a currency against itself without asking a source", async () => {
    const { state, get } = await setup();
    const res = await get("date=2025-06-02&base=TWD&quote=TWD");
    expect(await res.json<Rate>()).toMatchObject({ rateScaled: 1_000_000, rateDate: "2025-06-02" });
    expect(state.calls).toHaveLength(0);
  });

  it("rejects a bad query", async () => {
    const { get } = await setup();
    expect((await get("date=2025-13-01&base=USD&quote=TWD")).status).toBe(400);
    expect((await get("date=2025-06-02&base=JPY&quote=TWD")).status).toBe(400);
  });
});

describe("daily rate refresh", () => {
  it("stores today's rate for both directions of the pair", async () => {
    const { state, source } = fakeSource();
    state.answer = () => ({ rateDate: "2025-07-01", rateScaled: 29_000_000 });
    const db = createDb(env.DB);

    await refreshRates(db, source, Date.parse("2025-07-01T16:30:00Z"));

    expect(state.calls).toHaveLength(2);
    expect(state.calls).toEqual(
      expect.arrayContaining([
        { date: "2025-07-01", base: "USD", quote: "TWD" },
        { date: "2025-07-01", base: "TWD", quote: "USD" },
      ]),
    );
    const { state: later, get } = await setup();
    later.down = true;
    expect(await (await get("date=2025-07-01&base=USD&quote=TWD")).json<Rate>()).toMatchObject({
      rateScaled: 29_000_000,
      stale: false,
    });
  });
});
