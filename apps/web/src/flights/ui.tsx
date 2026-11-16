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
    tripType: item.tripType,
    lang,
  });
  if (item.inDate !== null) params.set("inDate", item.inDate);
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

const EN_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

interface MonthDay {
  month: number;
  day: number;
}

function parseMonthDay(iso: string): MonthDay | null {
  const match = /^\d{4}-(\d{2})-(\d{2})/.exec(iso);
  if (match === null) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? { month, day } : null;
}

function monthDayLabel({ month, day }: MonthDay, lang: Language): string {
  return lang === "en" ? `${EN_MONTHS[month - 1] ?? ""} ${day}` : `${month}月${day}日`;
}

/**
 * Fare dates without the year (the board only holds the current season): `12月1日 – 5日`,
 * cross-month `12月28日 – 1月3日`, one-way `12月1日`, same-day `12月9日 當天來回`;
 * English `Dec 1 – 5`, `Dec 28 – Jan 3`, `Dec 1`, `Dec 9 · same day`.
 */
export function formatFareDates(outDate: string, inDate: string | null, lang: Language): string {
  const out = parseMonthDay(outDate);
  if (out === null) return outDate;
  const outLabel = monthDayLabel(out, lang);
  if (inDate === null) return outLabel;
  const back = parseMonthDay(inDate);
  if (back === null) return outLabel;
  if (out.month === back.month && out.day === back.day) {
    return lang === "en" ? `${outLabel} · same day` : `${outLabel} 當天來回`;
  }
  const backLabel =
    out.month === back.month
      ? lang === "en"
        ? `${back.day}`
        : `${back.day}日`
      : monthDayLabel(back, lang);
  return `${outLabel} – ${backLabel}`;
}

/** Stops on the worse leg; 0 means nonstop. */
export function fareStops(item: DailyFlightItem): number {
  return Math.max(item.transfers, item.returnTransfers ?? 0);
}

function formatTripSpan(item: DailyFlightItem): string {
  if (item.inDate === null) return t("flights.tripOneWay");
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
  const maxStops = Math.max(item.transfers, item.returnTransfers ?? 0);
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
