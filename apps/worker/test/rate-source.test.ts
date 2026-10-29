import { describe, expect, it } from "vitest";
import {
  exchangeRateApiSource,
  frankfurterSource,
  withFallback,
} from "../src/rates/rate-source.js";

/** A fetch that answers each URL from a table and records what was asked. */
function fakeFetch(answers: Record<string, unknown>) {
  const asked: string[] = [];
  const fetchFn = (input: RequestInfo | URL): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    asked.push(url);
    return Promise.resolve(
      url in answers ? Response.json(answers[url]) : new Response("unavailable", { status: 503 }),
    );
  };
  return { asked, fetchFn };
}

describe("rate sources", () => {
  it("reads Frankfurter's rate for a day, with the day it was published for", async () => {
    const { asked, fetchFn } = fakeFetch({
      "https://api.frankfurter.dev/v1/2025-04-05?base=USD&symbols=TWD": {
        amount: 1,
        base: "USD",
        date: "2025-04-04",
        rates: { TWD: 33.0612 },
      },
    });
    const rate = await frankfurterSource(fetchFn).fetchRate("2025-04-05", "USD", "TWD");
    expect(rate).toEqual({ rateDate: "2025-04-04", rateScaled: 33_061_200 });
    expect(asked).toHaveLength(1);
  });

  it("falls back to ExchangeRate-API's latest rate when Frankfurter fails", async () => {
    const { fetchFn } = fakeFetch({
      "https://open.er-api.com/v6/latest/TWD": {
        result: "success",
        time_last_update_unix: Date.parse("2025-04-07T00:02:31Z") / 1000,
        rates: { USD: 0.030246 },
      },
    });
    const source = withFallback(frankfurterSource(fetchFn), exchangeRateApiSource(fetchFn));
    expect(await source.fetchRate("2025-04-07", "TWD", "USD")).toEqual({
      rateDate: "2025-04-07",
      rateScaled: 30_246,
    });
  });

  it("does not take ExchangeRate-API's latest rate for an earlier day", async () => {
    const { fetchFn } = fakeFetch({
      "https://open.er-api.com/v6/latest/USD": {
        result: "success",
        time_last_update_unix: Date.parse("2025-04-07T00:02:31Z") / 1000,
        rates: { TWD: 33 },
      },
    });
    await expect(
      exchangeRateApiSource(fetchFn).fetchRate("2025-03-01", "USD", "TWD"),
    ).rejects.toThrow();
  });

  it("fails when every source fails", async () => {
    const { fetchFn } = fakeFetch({});
    const source = withFallback(frankfurterSource(fetchFn), exchangeRateApiSource(fetchFn));
    await expect(source.fetchRate("2025-04-07", "USD", "TWD")).rejects.toThrow();
  });
});
