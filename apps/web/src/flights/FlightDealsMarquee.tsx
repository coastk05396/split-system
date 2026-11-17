import { type DailyFlightItem, type Language, sortDailyFlights } from "@split/shared";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router";
import { getLocale, t } from "../i18n/messages.js";
import { useDailyFlights } from "./api.js";
import { DealBadge, Price, RouteChip } from "./CityFlightCard.js";
import { CountryFlag } from "./CountryFlag.js";
import { FlightBetaBadge } from "./FlightBetaBadge.js";
import { flightCityLabel, flightDestinationLabel, tripGoHref } from "./ui.js";

/**
 * Interactive horizontal marquee of top daily flight deals for signed-in Home.
 * Loops seamlessly via duplicated GPU-composited track and pauses on hover or focus.
 */
export function FlightDealsMarquee() {
  const locale = getLocale();
  const flights = useDailyFlights();
  const topDeals = sortDailyFlights(flights.data.items, "discount", "desc").slice(0, 8);
  const showFallback = flights.data.isFallback && !flights.isPending;

  if (topDeals.length === 0) return null;

  return (
    <section aria-labelledby="home-flights-marquee" className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2
            id="home-flights-marquee"
            className="font-serif-tc text-[22px] leading-[30px] font-bold"
          >
            {t("home.flightsMarquee.title")}
          </h2>
          <FlightBetaBadge />
        </div>

        <Link
          to="/flights"
          className="press-pill group flex min-h-11 shrink-0 items-center gap-0.5 text-sm font-semibold text-fl-green"
        >
          <span>{t("home.flightsMarquee.more")}</span>
          <ChevronRight aria-hidden="true" className="hover-nudge-x size-4" />
        </Link>
      </div>

      <p className="-mt-2 text-[13px] leading-[18px] text-fl-muted">
        {showFallback ? t("flights.fallbackNote") : t("flights.refreshSchedule")}
      </p>

      <div className="flight-marquee flight-marquee-mask -mx-1 overflow-hidden px-1">
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

  return (
    <a
      href={tripGoHref(item, lang)}
      target="_blank"
      rel="noopener noreferrer"
      tabIndex={decorative ? -1 : undefined}
      className="press-card flight-card flex w-[200px] shrink-0 flex-col gap-3 rounded-2xl border border-[#e9e6de] bg-white p-4 shadow-[0_1px_2px_rgb(18_25_21/0.04),0_10px_24px_-16px_rgb(18_25_21/0.14)] focus-visible:outline-2 focus-visible:outline-fl-green"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <CountryFlag countryCode={dest.countryCode} className="size-7 shrink-0" />
        <span className="truncate text-base leading-6 font-semibold text-fl-ink">
          {flightCityLabel(item, lang)}
        </span>
      </div>
      <Price item={item} size="tile" />
      <div className="flex items-center justify-between gap-2">
        <RouteChip item={item} />
        <DealBadge item={item} className="shrink-0" />
      </div>
    </a>
  );
}
