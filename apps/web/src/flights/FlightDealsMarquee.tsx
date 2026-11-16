import { type DailyFlightItem, type Language, sortDailyFlights } from "@split/shared";
import { ChevronRight, Pause, Plane, Play } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { getLocale, t } from "../i18n/messages.js";
import { useDailyFlights } from "./api.js";
import { CountryFlag } from "./CountryFlag.js";
import { FlightBetaBadge } from "./FlightBetaBadge.js";
import { flightDestinationLabel, tripGoHref } from "./ui.js";

/**
 * Interactive horizontal marquee of top daily flight deals for signed-in Home.
 * Loops seamlessly via duplicated GPU-composited track and pauses on hover, focus, or explicit toggle.
 */
export function FlightDealsMarquee() {
  const locale = getLocale();
  const flights = useDailyFlights();
  const [paused, setPaused] = useState(false);
  const topDeals = sortDailyFlights(flights.data.items, "discount", "desc").slice(0, 8);
  const isFallback = flights.isPending || flights.data.isFallback;

  if (topDeals.length === 0) return null;

  return (
    <section aria-labelledby="home-flights-marquee" className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="home-flights-marquee" className="text-xl font-bold">
            {t("home.flightsMarquee.title")}
          </h2>
          <FlightBetaBadge />
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
              isFallback ? "bg-amber-100 text-amber-800" : "bg-sprout-100 text-sprout-700"
            }`}
          >
            {isFallback ? t("home.flightsMarquee.fallbackBadge") : t("home.flightsMarquee.badge")}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            aria-pressed={paused}
            aria-label={paused ? t("home.flightsMarquee.resume") : t("home.flightsMarquee.pause")}
            onClick={() => {
              setPaused((prev) => !prev);
            }}
            className="press-pill inline-flex cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white p-1.5 text-slate-600 shadow-2xs transition-colors hover:border-sprout-300 hover:text-sprout-700 motion-reduce:hidden"
          >
            {paused ? (
              <Play aria-hidden="true" className="size-3.5" />
            ) : (
              <Pause aria-hidden="true" className="size-3.5" />
            )}
          </button>
          <Link
            to="/flights"
            className="press-pill group flex items-center gap-0.5 text-sm font-bold text-sprout-600 hover:text-sprout-700"
          >
            <span>{t("home.flightsMarquee.more")}</span>
            <ChevronRight aria-hidden="true" className="hover-nudge-x size-4" />
          </Link>
        </div>
      </div>

      {flights.data.isFallback && !flights.isPending && (
        <p className="text-xs text-slate-500">{t("flights.fallbackNote")}</p>
      )}

      <div
        className={`flight-marquee flight-marquee-mask -mx-1 overflow-hidden px-1${paused ? " flight-marquee-paused" : ""}`}
      >
        <div className="flight-marquee-track gap-3 py-1">
          {topDeals.map((item) => (
            <MarqueeDealTile key={item.id} item={item} lang={locale} />
          ))}
          <div aria-hidden="true" className="flight-marquee-clone flex shrink-0 gap-3">
            {topDeals.map((item) => (
              <MarqueeDealTile key={`clone-${item.id}`} item={item} lang={locale} decorative />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function MarqueeDealTile({
  item,
  lang,
  decorative = false,
}: {
  item: DailyFlightItem;
  lang: Language;
  decorative?: boolean;
}) {
  const dest = flightDestinationLabel(item, lang);
  const routeText = `${item.origin} ${item.tripType === "rt" ? "⇄" : "→"} ${item.dest}`;
  const priceText = item.priceTwd.toLocaleString("en-US");

  return (
    <a
      href={tripGoHref(item, lang)}
      target="_blank"
      rel="noopener noreferrer"
      tabIndex={decorative ? -1 : undefined}
      className="press-card surface-card flight-card flex w-[228px] shrink-0 flex-col justify-between gap-2 rounded-2xl border border-sprout-200/80 bg-white px-3.5 py-2.5 shadow-2xs"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <CountryFlag countryCode={dest.countryCode} className="size-7 shrink-0 shadow-2xs" />
          <span className="truncate text-sm font-bold text-slate-900">{dest.city}</span>
        </div>
        <div className="inline-flex shrink-0 items-baseline gap-0.5">
          <span className="text-[10px] font-semibold text-slate-400">NT$</span>
          <span className="text-base font-extrabold leading-none tracking-tight text-slate-900 tabular-nums">
            {priceText}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 rounded-full border border-sprout-200/80 bg-sprout-50 px-1.5 py-0.5 text-[10px] font-semibold text-sprout-700 tabular-nums">
          <Plane aria-hidden="true" className="size-2.5 text-sprout-500" />
          <span>{routeText}</span>
        </span>
        {item.discountPct >= 15 && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-sprout-600/90 tabular-nums">
            {item.discountPct >= 30 && (
              <span aria-hidden="true" className="size-1 rounded-full bg-sprout-500" />
            )}
            <span>{t("flights.deal.save", { pct: item.discountPct })}</span>
          </span>
        )}
      </div>
    </a>
  );
}
