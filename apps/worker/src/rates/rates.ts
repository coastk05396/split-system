import {
  CURRENCY_CODES,
  type CurrencyCode,
  RATE_SCALE,
  type Rate,
  type RateQuery,
} from "@split/shared";
import { and, desc, eq, lte } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { fxRates } from "../db/schema.js";
import { ApiError } from "../errors.js";
import type { FetchedRate, RateSource } from "./rate-source.js";

/** A day still unpublished (today or later) is asked for again at most once an hour. */
const RETRY_AFTER_MS = 3_600_000;

const utcDate = (moment: number): string => new Date(moment).toISOString().slice(0, 10);

type RateRow = typeof fxRates.$inferSelect;

const toRate = (row: RateRow, stale: boolean): Rate => ({
  base: row.baseCurrency,
  quote: row.quoteCurrency,
  rateScaled: row.rateScaled,
  rateDate: row.publishedDate ?? row.rateDate,
  stale,
});

async function cachedRow(
  db: Db,
  base: CurrencyCode,
  quote: CurrencyCode,
  onOrBefore?: string,
): Promise<RateRow | undefined> {
  const [row] = await db
    .select()
    .from(fxRates)
    .where(
      and(
        eq(fxRates.baseCurrency, base),
        eq(fxRates.quoteCurrency, quote),
        onOrBefore === undefined ? undefined : lte(fxRates.rateDate, onOrBefore),
      ),
    )
    .orderBy(desc(fxRates.rateDate))
    .limit(1);
  return row;
}

/**
 * Whether the row cached for the asked day answers it: a past day's rate never changes, and a
 * day the source has not published yet (it gave an earlier day's rate) is retried hourly.
 */
function answers(row: RateRow, date: string, now: number): boolean {
  if (row.rateDate !== date) return false;
  const published = row.publishedDate ?? row.rateDate;
  return (
    published === date || date < utcDate(row.fetchedAt) || now - row.fetchedAt < RETRY_AFTER_MS
  );
}

/** Caches a fetched rate under the asked day, noting the day it was published for. */
async function store(
  db: Db,
  date: string,
  base: CurrencyCode,
  quote: CurrencyCode,
  fetched: FetchedRate,
  now: number,
): Promise<RateRow> {
  const row: RateRow = {
    rateDate: date,
    baseCurrency: base,
    quoteCurrency: quote,
    rateScaled: fetched.rateScaled,
    publishedDate: fetched.rateDate === date ? null : fetched.rateDate,
    fetchedAt: now,
  };
  await db
    .insert(fxRates)
    .values(row)
    .onConflictDoUpdate({
      target: [fxRates.rateDate, fxRates.baseCurrency, fxRates.quoteCurrency],
      set: { rateScaled: row.rateScaled, publishedDate: row.publishedDate, fetchedAt: now },
    });
  return row;
}

/**
 * The reference rate for an Expense's date (decision 11): the D1 cache when it answers, else
 * the sources (whose answer is cached for that day). With every source down it is the newest
 * cached rate, marked stale; with nothing cached the user must type a rate (503).
 */
export async function lookupRate(
  db: Db,
  source: RateSource,
  query: RateQuery,
  now: number,
): Promise<Rate> {
  const { date, base, quote } = query;
  if (base === quote) return { base, quote, rateScaled: RATE_SCALE, rateDate: date, stale: false };

  const cached = await cachedRow(db, base, quote, date);
  if (cached !== undefined && answers(cached, date, now)) return toRate(cached, false);

  const today = utcDate(now);
  let fetched: FetchedRate;
  try {
    fetched = await source.fetchRate(date < today ? date : today, base, quote);
  } catch {
    const fallback = cached ?? (await cachedRow(db, base, quote));
    if (fallback === undefined) throw new ApiError("RATE_UNAVAILABLE");
    return toRate(fallback, true);
  }
  return toRate(await store(db, date, base, quote, fetched, now), false);
}

/** The daily Cron Trigger: caches today's rate for every ordered pair of currencies. */
export async function refreshRates(db: Db, source: RateSource, now: number): Promise<void> {
  const today = utcDate(now);
  for (const base of CURRENCY_CODES) {
    for (const quote of CURRENCY_CODES) {
      if (base === quote) continue;
      try {
        await store(db, today, base, quote, await source.fetchRate(today, base, quote), now);
      } catch (error) {
        // One failed pair must not stop the other; the next request or run fetches it.
        console.error(
          JSON.stringify({ event: "rate_refresh_failed", base, quote, error: String(error) }),
        );
      }
    }
  }
}
