import { type DailyFlightItem, getAirlineName, type Language } from "@split/shared";
import { ChevronDown, ChevronUp, ExternalLink, Moon } from "lucide-react";
import { Fragment, type ReactNode, useId, useState } from "react";
import { t } from "../i18n/messages.js";
import { CountryFlag } from "./CountryFlag.js";
import type { CityGroup } from "./groups.js";
import {
  fareStops,
  FlightBookAnchor,
  flightCityLabel,
  flightDestinationLabel,
  flightOriginCityLabel,
  formatFareDates,
} from "./ui.js";

/** Expanded cards list this many fares (cheapest first); the rest sit behind `看全部 N 筆`. */
const COLLAPSED_FARES = 5;

/** Discount display: soft pill from 40%, plain `省 X%` for 15-39%, nothing below 15%. */
const SOFT_PILL_MIN_PCT = 40;
const SIGNAL_MIN_PCT = 15;

export function routeText(item: DailyFlightItem): string {
  return `${item.origin} ${item.tripType === "rt" ? "⇄" : "→"} ${item.dest}`;
}

function airlineLabel(item: DailyFlightItem, lang: Language): string {
  return getAirlineName(item.airlines[0] ?? "", lang);
}

export function RouteChip({ item, className = "" }: { item: DailyFlightItem; className?: string }) {
  return (
    <span
      className={`flight-card-route shrink-0 rounded-md bg-fl-tint px-1.5 text-xs leading-[18px] font-semibold whitespace-nowrap text-fl-green tabular-nums ${className}`}
    >
      {routeText(item)}
    </span>
  );
}

export function DealBadge({ item, className = "" }: { item: DailyFlightItem; className?: string }) {
  const pct = item.discountPct;
  if (pct < SIGNAL_MIN_PCT) return null;
  const text = t("flights.deal.save", { pct });
  if (pct >= SOFT_PILL_MIN_PCT) {
    return (
      <span
        className={`inline-block rounded-md bg-fl-tint px-[7px] text-xs leading-[18px] font-semibold whitespace-nowrap text-fl-green tabular-nums ${className}`}
      >
        {text}
      </span>
    );
  }
  return (
    <span
      className={`inline-block text-[13px] leading-[18px] font-semibold whitespace-nowrap text-fl-green tabular-nums ${className}`}
    >
      {text}
    </span>
  );
}

const PRICE_SIZE = {
  card: "text-2xl leading-[30px]",
  row: "text-xl leading-[26px]",
  tile: "text-[28px] leading-8",
} as const;

export function Price({
  item,
  size,
  className = "",
}: {
  item: DailyFlightItem;
  size: keyof typeof PRICE_SIZE;
  className?: string;
}) {
  return (
    <span className={`flex items-baseline gap-[3px] ${className}`}>
      <span className="text-[11px] font-medium text-fl-muted">NT$</span>
      <span
        className={`font-num font-semibold tracking-[-0.01em] text-fl-ink tabular-nums lining-nums ${PRICE_SIZE[size]}`}
      >
        {item.priceTwd.toLocaleString("en-US")}
      </span>
    </span>
  );
}

function RedEye() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-indigo-700">
      <Moon aria-hidden="true" className="size-3" />
      <span>{t("flights.badge.redEyeText")}</span>
    </span>
  );
}

/** Row detail line: `最低價 · 高雄出發 · 航司 · 轉機 N 次 · 紅眼`; only what applies is shown. */
function rowDetail(
  fare: DailyFlightItem,
  isCheapest: boolean,
  primaryOrigin: string,
  lang: Language,
): ReactNode[] {
  const stops = fareStops(fare);
  const parts: ReactNode[] = [];
  if (isCheapest) {
    parts.push(
      <span key="lowest" className="font-semibold text-fl-green">
        {t("flights.lowest")}
      </span>,
    );
  }
  if (fare.origin !== primaryOrigin) {
    parts.push(t("flights.fromOrigin", { city: flightOriginCityLabel(fare.origin, lang) }));
  }
  parts.push(airlineLabel(fare, lang));
  if (stops > 0) {
    parts.push(
      t(stops === 1 ? "flights.badge.transfer" : "flights.badge.transfer.many", { count: stops }),
    );
  }
  if (fare.isRedEye) parts.push(t("flights.badge.redEyeText"));
  return parts;
}

/** One destination: collapsed summary of its cheapest fare; tap to list its fares. */
export function CityFlightCard({ group, lang }: { group: CityGroup; lang: Language }) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const panelId = useId();
  const { cheapest, fares } = group;
  const dest = flightDestinationLabel(cheapest, lang);
  const shown = showAll ? fares : fares.slice(0, COLLAPSED_FARES);

  return (
    <div className="flight-card overflow-hidden rounded-[18px] border border-[#e9e6de] bg-white shadow-[0_1px_2px_rgb(18_25_21/0.04),0_12px_28px_-16px_rgb(18_25_21/0.14)]">
      <h2 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => {
            setOpen((prev) => !prev);
          }}
          className="press-card flex min-h-20 w-full min-w-0 cursor-pointer items-center gap-3 px-4 py-4 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-fl-green min-[360px]:px-[18px]"
        >
          <CountryFlag countryCode={dest.countryCode} className="size-9 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2">
              <span className="flight-card-city max-w-full min-w-0 truncate text-[17px] leading-[26px] font-semibold whitespace-nowrap text-fl-ink">
                {flightCityLabel(cheapest, lang)}
              </span>
              <RouteChip item={cheapest} />
            </span>
            <span className="flex min-w-0 items-center gap-1 text-[13px] leading-[18px] whitespace-nowrap text-fl-muted">
              <span className="min-w-0 truncate">{airlineLabel(cheapest, lang)}</span>
              {cheapest.isRedEye && (
                <>
                  <span aria-hidden="true">·</span>
                  <RedEye />
                </>
              )}
            </span>
          </span>
          <span className="shrink-0 text-right">
            <Price item={cheapest} size="card" className="justify-end" />
            <DealBadge item={cheapest} className="mt-0.5" />
          </span>
          {open ? (
            <ChevronUp aria-hidden="true" className="size-4 shrink-0 text-fl-ink" />
          ) : (
            <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-[#8a918b]" />
          )}
        </button>
      </h2>

      {open && (
        <div id={panelId} className="border-t border-fl-hair-soft bg-fl-sheet">
          <ul>
            {shown.map((fare, index) => (
              <li
                key={fare.id}
                className={`min-w-0 ${index === 0 ? "bg-fl-first" : "border-t border-[#eeebe3]"}`}
              >
                <FlightBookAnchor
                  item={fare}
                  lang={lang}
                  className="flex min-h-16 w-full min-w-0 items-center gap-3 py-3 pr-4 pl-[60px] min-[360px]:pr-[18px] min-[390px]:pl-[66px] transition-colors hover:bg-fl-ink/[0.03] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-fl-green"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] leading-[22px] font-semibold text-fl-ink">
                      {formatFareDates(fare.outDate, fare.inDate, lang)}
                    </span>
                    <span className="block text-[13px] leading-[18px] text-fl-muted">
                      {rowDetail(fare, index === 0, cheapest.origin, lang).map((part, i) => (
                        <Fragment key={i}>
                          {i > 0 && " · "}
                          {part}
                        </Fragment>
                      ))}
                    </span>
                  </span>
                  <Price item={fare} size="row" className="shrink-0" />
                  <ExternalLink aria-hidden="true" className="size-3.5 shrink-0 text-[#8a918b]" />
                </FlightBookAnchor>
              </li>
            ))}
          </ul>
          {fares.length > COLLAPSED_FARES && (
            <button
              type="button"
              aria-expanded={showAll}
              onClick={() => {
                setShowAll((prev) => !prev);
              }}
              className="flex min-h-12 w-full cursor-pointer items-center justify-center gap-1 border-t border-[#eeebe3] text-sm font-semibold text-fl-green focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-fl-green"
            >
              {showAll ? t("flights.showLess") : t("flights.showAll", { count: fares.length })}
              {showAll ? (
                <ChevronUp aria-hidden="true" className="size-4" />
              ) : (
                <ChevronDown aria-hidden="true" className="size-4" />
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
