import {
  formatAmount,
  type CurrencyCode,
  type FlightPriceStripReply,
  type FlightSearchIntent,
} from "@split/shared";
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { useAuth } from "../auth/AuthProvider.js";
import { readWithRev } from "../groups/data.js";
import { t } from "../i18n/messages.js";
import { prefersReducedMotion } from "../shell/motion.js";
import { friendlyDate } from "./dates.js";

const HOUR = 3_600_000;
/** Saved prices older than this say how old they are. */
const OLD_AFTER_HOURS = 6;
const SKELETON_HEIGHTS = [45, 70, 55, 85, 60, 40, 75, 90, 50, 65];

/** Read-only: the endpoint serves stored Fare Snapshots and never starts a search (ADR 0007). */
function usePriceStrip(origin: string, destination: string, currency: CurrencyCode, month: string) {
  const { session } = useAuth();
  return useQuery({
    queryKey: ["flights", "price-strip", origin, destination, currency, month],
    // An unavailable line beats a long retry wait; the strip must never spin for long.
    retry: false,
    queryFn: ({ signal }) =>
      readWithRev<FlightPriceStripReply>(
        session.fetch(
          `/api/v1/flights/price-strip?${new URLSearchParams({ origin, destination, currency, month }).toString()}`,
          { signal },
        ),
      ),
  });
}

/**
 * The month's cheapest fare per day, from saved Fare Snapshots only. Cheapest days are dark green
 * (amber stays with 最低 Date Tiles and 強烈買); height carries the price. Not the Date Tiles.
 */
export function PriceStrip({ intent }: { intent: FlightSearchIntent }) {
  const heading = useId();
  const month = intent.departureDate.slice(0, 7);
  const query = usePriceStrip(intent.origin, intent.destination, intent.currency, month);
  const total = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
  const days = query.data?.days ?? [];
  const byDate = new Map(days.map((day) => [day.date, day]));
  const low = Math.min(...days.map((day) => day.price));
  const high = Math.max(...days.map((day) => day.price));
  const cheapest = days.filter((day) => day.price === low);
  const oldestHours = Math.floor((Date.now() - Math.min(...days.map((d) => d.fetchedAt))) / HOUR);

  return (
    <section aria-labelledby={heading} className="mt-5 grid gap-2 px-1">
      <h2 id={heading} className="text-[17px] font-black">
        {t("flight.stripTitle", { month: month.replace("-", "/") })}
      </h2>
      {query.isPending ? (
        <div
          role="status"
          aria-busy="true"
          aria-label={t("flight.stripLoading")}
          className="flex h-[72px] items-end gap-0.5"
        >
          {Array.from({ length: total }, (_, i) => (
            <div
              key={i}
              aria-hidden="true"
              className={`min-w-0 flex-1 rounded-t-sm bg-[#b3bbb6] ${prefersReducedMotion() ? "" : "strip-pulse"}`}
              style={{ height: `${String(SKELETON_HEIGHTS[i % SKELETON_HEIGHTS.length])}%` }}
            />
          ))}
        </div>
      ) : days.length === 0 ? (
        <p className="text-[15px] font-bold text-ink-muted">{t("flight.stripUnavailable")}</p>
      ) : (
        <>
          <ul className="flex h-[72px] items-end gap-0.5">
            {Array.from({ length: total }, (_, i) => {
              const date = `${month}-${String(i + 1).padStart(2, "0")}`;
              const day = byDate.get(date);
              const isCheapest = day?.price === low;
              return (
                <li
                  key={date}
                  data-cheapest={isCheapest ? "true" : undefined}
                  aria-label={
                    day
                      ? `${friendlyDate(date)} · ${formatAmount(day.price, intent.currency)}${isCheapest ? ` · ${t("flight.stripLegendCheapest")}` : ""}`
                      : `${friendlyDate(date)} · ${t("flight.stripNoPrice")}`
                  }
                  className="flex h-full min-w-0 flex-1 items-end"
                >
                  <div
                    aria-hidden="true"
                    className={`w-full rounded-t-sm ${isCheapest ? "bg-sprout-900" : day ? "bg-[#2b8f67]" : "bg-sprout-200"}`}
                    style={{
                      height: day ? `${String(Math.max(12, (day.price / high) * 100))}%` : "4%",
                    }}
                  />
                </li>
              );
            })}
          </ul>
          <p className="text-[15px] font-bold text-sprout-700">
            {t("flight.stripCheapest", {
              date: friendlyDate(cheapest[0]?.date ?? ""),
              amount: formatAmount(low, intent.currency),
            })}
          </p>
          <p className="flex flex-wrap gap-x-4 text-sm font-medium text-ink-muted">
            <span className="inline-flex items-center gap-1.5">
              <i aria-hidden="true" className="size-2.5 rounded-sm bg-sprout-900" />
              {t("flight.stripLegendCheapest")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i aria-hidden="true" className="size-2.5 rounded-sm bg-[#2b8f67]" />
              {t("flight.stripLegendOther")}
            </span>
          </p>
          {oldestHours >= OLD_AFTER_HOURS && (
            <p className="text-sm font-medium text-ink-muted">
              {t("flight.stripAge", { hours: String(oldestHours) })}
            </p>
          )}
          <p className="text-sm font-medium text-ink-muted">{t("flight.stripNote")}</p>
        </>
      )}
    </section>
  );
}
