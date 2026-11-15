import {
  type DailyFlightItem,
  getAirlineName,
  getDestinationMeta,
  type Language,
  matchTaiwanHoliday,
} from "@split/shared";
import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { t } from "../i18n/messages.js";

/** Builds our stateless same-origin redirect path to localized Trip.com search results. */
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

export function formatFlightDates(item: DailyFlightItem): string {
  const outShort = item.outDate.slice(5).replace("-", "/");
  if (item.inDate === null) return outShort;
  const inShort = item.inDate.slice(5).replace("-", "/");
  return `${outShort} – ${inShort}`;
}

export function flightDestinationLabel(
  item: DailyFlightItem,
  lang: Language,
): {
  flag: string;
  city: string;
} {
  const meta = getDestinationMeta(item.dest);
  if (meta === null) return { flag: "✈️", city: item.dest };
  return {
    flag: meta.flag,
    city: lang === "en" ? meta.en : meta.zhTW,
  };
}

export function flightHolidayLabel(item: DailyFlightItem, lang: Language): string | null {
  const holiday = matchTaiwanHoliday(item.outDate, item.inDate);
  if (holiday === null) return null;
  return `${holiday.emoji} ${lang === "en" ? holiday.en : holiday.zhTW}`;
}

export function FlightBadges({ item, lang }: { item: DailyFlightItem; lang: Language }) {
  const holiday = flightHolidayLabel(item, lang);
  const maxStops = Math.max(item.transfers, item.returnTransfers ?? 0);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {item.tag === "steal" && (
        <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900">
          {t("flights.deal.steal", { pct: item.discountPct })}
        </span>
      )}
      {item.tag === "below_market" && (
        <span className="inline-flex items-center rounded-full bg-sprout-100 px-2 py-0.5 text-[11px] font-bold text-sprout-700">
          {t("flights.deal.below", { pct: item.discountPct })}
        </span>
      )}
      {item.isRedEye && (
        <span className="inline-flex items-center rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-bold text-slate-100">
          {t("flights.badge.redEye")}
        </span>
      )}
      <span className="inline-flex items-center rounded-full bg-sprout-50 px-2 py-0.5 text-[11px] font-medium text-sprout-900">
        {maxStops === 0 ? t("flights.badge.direct") : t("flights.badge.stops", { count: maxStops })}
      </span>
      {holiday !== null && (
        <span className="inline-flex items-center rounded-full bg-peach px-2 py-0.5 text-[11px] font-bold text-terracotta-ink">
          {holiday}
        </span>
      )}
    </div>
  );
}

export function FlightBookAnchor({
  item,
  lang,
  className = "",
  children,
}: {
  item: DailyFlightItem;
  lang: Language;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <a
      href={tripGoHref(item, lang)}
      target="_blank"
      rel="noopener noreferrer"
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

export function formatFlightDepTimes(item: DailyFlightItem): string | null {
  if (!item.outboundDep) return null;
  if (item.tripType === "rt" && item.inboundDep) {
    return `${item.outboundDep} / ${item.inboundDep}`;
  }
  return item.outboundDep;
}

export function FlightAirlineSummary({ item, lang }: { item: DailyFlightItem; lang: Language }) {
  const airlinesLabel = item.airlines.map((code) => getAirlineName(code, lang)).join(" / ");
  const depTimes = formatFlightDepTimes(item);
  const durationLabel =
    item.tripType === "rt" && item.inDate !== null
      ? t("flights.tripDays", {
          days: Math.max(
            1,
            Math.round(
              (Date.parse(`${item.inDate}T00:00:00Z`) - Date.parse(`${item.outDate}T00:00:00Z`)) /
                86_400_000,
            ),
          ),
        })
      : t("flights.tripOneWay");
  return (
    <span>
      {airlinesLabel} · {formatFlightDates(item)}
      {depTimes !== null ? ` · ${depTimes}` : ""} · {durationLabel}
    </span>
  );
}

export { PublicHeader } from "./PublicHeader.js";
