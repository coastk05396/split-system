import {
  type DailyFlightItem,
  type FlightOrigin,
  getCityName,
  getDestinationMeta,
  type Language,
  ORIGIN_META,
} from "@split/shared";
import { ExternalLink } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { useDeps } from "../app/AppProviders.js";
import { t } from "../i18n/messages.js";

/** Builds our stateless same-origin redirect path to localized booking search results. */
export function tripGoHref(item: DailyFlightItem, lang: Language): string {
  const params = new URLSearchParams({
    origin: item.origin,
    dest: item.dest,
    outDate: item.outDate,
    inDate: item.inDate,
    lang,
  });
  return `/api/v1/flights/go?${params.toString()}`;
}

export function flightDestinationLabel(
  item: DailyFlightItem,
  lang: Language,
): {
  countryCode: string;
  flag: string;
  city: string;
} {
  const meta = getDestinationMeta(item.dest);
  if (meta === null) return { countryCode: "UNKNOWN", flag: "✈️", city: item.dest };
  return {
    countryCode: meta.countryCode,
    flag: meta.flag,
    city: lang === "en" ? meta.en : meta.zhTW,
  };
}

/** City-only name (`東京`), no airport suffix; the route chip carries the airport. */
export function flightCityLabel(item: DailyFlightItem, lang: Language): string {
  return getCityName(item.dest, lang);
}

export function FlightBookAnchor({
  item,
  lang,
  className = "",
  ariaLabel,
  children,
}: {
  item: DailyFlightItem;
  lang: Language;
  className?: string;
  ariaLabel?: string;
  children?: ReactNode;
}) {
  const { line } = useDeps();
  const href = tripGoHref(item, lang);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!line.isInClient()) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    const target = new URL(href, window.location.origin).toString();
    void line.openExternal(target).catch(() => {
      window.open(href, "_blank", "noopener,noreferrer");
    });
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={ariaLabel}
      onClick={handleClick}
      className={className}
    >
      {children ?? (
        <>
          <span>{t("flights.bookCta")}</span>
          <ExternalLink aria-hidden="true" className="size-3.5" />
        </>
      )}
    </a>
  );
}

export function flightOriginCityLabel(origin: string, lang: Language): string {
  if (origin in ORIGIN_META) {
    const meta = ORIGIN_META[origin as FlightOrigin];
    return lang === "en" ? meta.shortEn : meta.shortZhTW;
  }
  return origin;
}

const MS_PER_DAY = 86_400_000;

/** `MM/DD` from an ISO date, or `null` when it is not a real month/day. */
function monthDay(iso: string): string | null {
  const match = /^\d{4}-(\d{2})-(\d{2})/.exec(iso);
  if (match === null) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? `${match[1]}/${match[2]}` : null;
}

/**
 * Fare dates without the year (the board only holds the current season), the same in every
 * language: `12/09–12/12` round trip, `12/09` same-day.
 */
export function formatFareDates(outDate: string, inDate: string): string {
  const out = monthDay(outDate);
  if (out === null) return outDate;
  const back = monthDay(inDate);
  return back === null || back === out ? out : `${out}–${back}`;
}

function formatTripSpan(item: DailyFlightItem): string {
  const outMs = Date.parse(`${item.outDate}T00:00:00Z`);
  const inMs = Date.parse(`${item.inDate}T00:00:00Z`);
  if (!Number.isFinite(outMs) || !Number.isFinite(inMs)) {
    return t("flights.tripType.rt");
  }
  const nights = Math.round((inMs - outMs) / MS_PER_DAY);
  if (nights <= 0) return t("flights.sameDay");
  return t("flights.tripDaysNights", { days: nights + 1, nights });
}

export function formatFlightTripSummary(item: DailyFlightItem, lang: Language): string {
  const outShort = item.outDate.slice(5).replace("-", "/");
  const city = flightOriginCityLabel(item.origin, lang);
  const departLabel = t("flights.departFrom", { date: outShort, city });
  const spanLabel = formatTripSpan(item);
  const maxStops = item.transfers;
  const stopLabel =
    maxStops === 0
      ? t("flights.badge.direct")
      : t(maxStops === 1 ? "flights.badge.stops" : "flights.badge.stops.many", { count: maxStops });
  return `${departLabel} · ${spanLabel} · ${stopLabel}`;
}

export { CountryFlag } from "./CountryFlag.js";
export { PublicHeader } from "./PublicHeader.js";

/** Bottom note: only the digest date; curated fallback fares are labelled as samples (ADR 0007). */
export function flightsUpdatedNote(date: string, isFallback: boolean): string {
  const short = date.length >= 10 ? date.slice(5).replace("-", "/") : date;
  return t(isFallback ? "flights.updatedSample" : "flights.updatedAt", { date: short });
}
