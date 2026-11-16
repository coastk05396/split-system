import {
  type DailyFlightItem,
  type FlightOrigin,
  getDestinationMeta,
  type Language,
  ORIGIN_META,
} from "@split/shared";
import { ExternalLink, Moon, Plane } from "lucide-react";
import type { ReactNode } from "react";
import { t } from "../i18n/messages.js";
import { CountryFlag } from "./CountryFlag.js";

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
  return (
    <a
      href={tripGoHref(item, lang)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={ariaLabel}
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
    maxStops === 0 ? t("flights.badge.direct") : t("flights.badge.stops", { count: maxStops });
  return `${departLabel} · ${spanLabel} · ${stopLabel}`;
}

/**
 * Sprout single-row travel card: SVG destination emblem, soft-mint airport route pill,
 * human origin/duration summary on the left; prominent TWD price + emerald savings on the right.
 */
export function CompactFlightCard({ item, lang }: { item: DailyFlightItem; lang: Language }) {
  const dest = flightDestinationLabel(item, lang);
  const routeText = `${item.origin} ${item.tripType === "rt" ? "⇄" : "→"} ${item.dest}`;
  const tripSummary = formatFlightTripSummary(item, lang);
  const priceText = item.priceTwd.toLocaleString("en-US");

  return (
    <FlightBookAnchor
      item={item}
      lang={lang}
      className="press-card flight-card flex items-center justify-between gap-3 rounded-2xl border border-slate-200/85 bg-white px-4 py-3.5 shadow-2xs"
    >
      <div className="flex min-w-0 items-center gap-3">
        <CountryFlag
          countryCode={dest.countryCode}
          className="size-9 shrink-0 shadow-2xs sm:size-10"
        />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h2 className="flight-card-city truncate text-[15px] font-bold text-slate-900">
              {dest.city}
            </h2>
            <span className="flight-card-route inline-flex shrink-0 items-center gap-1 rounded-full border border-sprout-200/80 bg-sprout-50 px-2 py-0.5 text-[11px] font-semibold tracking-tight text-sprout-700 tabular-nums">
              <Plane aria-hidden="true" className="flight-card-plane size-2.5 text-sprout-500" />
              <span>{routeText}</span>
            </span>
            {item.isRedEye && (
              <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                <Moon aria-hidden="true" className="size-2.5" />
                <span>{t("flights.badge.redEyeText")}</span>
              </span>
            )}
          </div>
          <p className="mt-1 truncate text-xs text-slate-500 tabular-nums">{tripSummary}</p>
        </div>
      </div>

      <div className="shrink-0 text-right">
        <div className="flex items-baseline justify-end gap-1">
          <span className="text-[11px] font-semibold text-slate-400">NT$</span>
          <span className="text-2xl font-black leading-none tracking-tight text-slate-900 tabular-nums sm:text-[26px]">
            {priceText}
          </span>
        </div>
        {item.discountPct >= 15 && (
          <p className="mt-1 inline-flex items-center justify-end gap-1 text-[11px] font-semibold text-sprout-600/90 tabular-nums">
            {item.discountPct >= 30 && (
              <span aria-hidden="true" className="size-1 shrink-0 rounded-full bg-sprout-500" />
            )}
            {t("flights.deal.save", { pct: item.discountPct })}
          </p>
        )}
      </div>
    </FlightBookAnchor>
  );
}

export { CountryFlag } from "./CountryFlag.js";
export { PublicHeader } from "./PublicHeader.js";
