import { type CurrencyCode, parseRate } from "@split/shared";
import { z } from "zod";

/** A reference rate: 1 base is `rateScaled / 1,000,000` quote, published for `rateDate`. */
export interface FetchedRate {
  rateDate: string;
  rateScaled: number;
}

/**
 * Where reference Exchange rates come from (decision 11). Answers the rate for `date`, or for
 * the last day before it with one; rejects when it cannot. Tests and local dev pass a fake.
 */
export interface RateSource {
  fetchRate(date: string, base: CurrencyCode, quote: CurrencyCode): Promise<FetchedRate>;
}

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 5_000;

async function getJson(fetchFn: FetchFn, url: string): Promise<unknown> {
  const res = await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`rate source answered ${String(res.status)}`);
  return res.json();
}

function toScaled(rate: number): number {
  const scaled = parseRate(rate.toFixed(6));
  if (!scaled.ok) throw new Error("rate source sent an unusable rate");
  return scaled.value;
}

const frankfurterBody = z.object({ date: z.string(), rates: z.record(z.string(), z.number()) });

/** Frankfurter (ECB-based, keyless): `/v1/{date}` answers that day or the last one before it. */
export function frankfurterSource(fetchFn: FetchFn): RateSource {
  return {
    async fetchRate(date, base, quote) {
      const url = `https://api.frankfurter.dev/v1/${date}?base=${base}&symbols=${quote}`;
      const body = frankfurterBody.parse(await getJson(fetchFn, url));
      const rate = body.rates[quote];
      if (rate === undefined) throw new Error("Frankfurter has no rate for the pair");
      return { rateDate: body.date, rateScaled: toScaled(rate) };
    },
  };
}

const erApiBody = z.object({
  result: z.literal("success"),
  time_last_update_unix: z.number(),
  rates: z.record(z.string(), z.number()),
});

/** ExchangeRate-API's open endpoint: only the latest rate, so it cannot answer an earlier day. */
export function exchangeRateApiSource(fetchFn: FetchFn): RateSource {
  return {
    async fetchRate(date, base, quote) {
      const body = erApiBody.parse(
        await getJson(fetchFn, `https://open.er-api.com/v6/latest/${base}`),
      );
      const rate = body.rates[quote];
      const rateDate = new Date(body.time_last_update_unix * 1000).toISOString().slice(0, 10);
      if (rate === undefined) throw new Error("ExchangeRate-API has no rate for the pair");
      if (rateDate > date) throw new Error("ExchangeRate-API only has a later rate");
      return { rateDate, rateScaled: toScaled(rate) };
    },
  };
}

/** Tries each source in turn; rejects with the last failure when none answers. */
export function withFallback(...sources: RateSource[]): RateSource {
  return {
    async fetchRate(date, base, quote) {
      let failure: unknown = new Error("no rate source");
      for (const source of sources) {
        try {
          return await source.fetchRate(date, base, quote);
        } catch (error) {
          failure = error;
        }
      }
      throw failure;
    },
  };
}

/** Frankfurter first, ExchangeRate-API as the fallback (decision 11). */
export function productionRateSource(
  fetchFn: FetchFn = (input, init) => fetch(input, init),
): RateSource {
  return withFallback(frankfurterSource(fetchFn), exchangeRateApiSource(fetchFn));
}
