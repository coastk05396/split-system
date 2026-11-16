import {
  type DailyFlightItem,
  type FlightRegion,
  getAirlineName,
  type Language,
} from "@split/shared";
import { ArrowUpRight, Calendar, ChevronDown, ChevronUp } from "lucide-react";
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

/** Discount display: solid pill from 30%, plain `省 X%` for 15-29%, nothing below 15%. */
const SOLID_PILL_MIN_PCT = 30;
const SIGNAL_MIN_PCT = 15;

/** Route chip colours per destination region; long-haul green is also the fallback. */
const REGION_CHIP: Record<FlightRegion, string> = {
  jp: "bg-[#fce7f3] text-[#9d174d]",
  kr: "bg-[#e0f2fe] text-[#075985]",
  sea: "bg-[#ffedd5] text-[#9a3412]",
  hkmo: "bg-[#f3e8ff] text-[#6b21a8]",
  longhaul: "bg-[#dff3e9] text-[#065f46]",
};

export function routeText(item: DailyFlightItem): string {
  return `${item.origin} ${item.tripType === "rt" ? "⇄" : "→"} ${item.dest}`;
}

function airlineLabel(item: DailyFlightItem, lang: Language): string {
  return getAirlineName(item.airlines[0] ?? "", lang);
}

export function RouteChip({ item, className = "" }: { item: DailyFlightItem; className?: string }) {
  return (
    <span
      className={`flight-card-route shrink-0 rounded-full px-2 py-0.5 text-xs font-bold tracking-[0.04em] whitespace-nowrap tabular-nums ${REGION_CHIP[item.region]} ${className}`}
    >
      {routeText(item)}
    </span>
  );
}

const DEAL_SIZE = {
  card: { solid: "px-2.5 py-[3px] text-xs", text: "text-xs" },
  row: { solid: "px-[9px] py-px text-[11px]", text: "text-[11px]" },
} as const;

export function DealBadge({
  item,
  size = "card",
  className = "",
}: {
  item: DailyFlightItem;
  size?: keyof typeof DEAL_SIZE;
  className?: string;
}) {
  const pct = item.discountPct;
  if (pct < SIGNAL_MIN_PCT) return null;
  const text = t("flights.deal.save", { pct });
  if (pct >= SOLID_PILL_MIN_PCT) {
    return (
      <span
        className={`inline-block rounded-full bg-fl-green font-bold whitespace-nowrap text-white tabular-nums ${DEAL_SIZE[size].solid} ${className}`}
      >
        {text}
      </span>
    );
  }
  return (
    <span
      className={`inline-block font-semibold whitespace-nowrap text-fl-green tabular-nums ${DEAL_SIZE[size].text} ${className}`}
    >
      {text}
    </span>
  );
}

const PRICE_STYLE = {
  card: {
    nt: "text-xs text-fl-muted",
    num: "text-[22px] leading-[26px] font-black tracking-[-0.02em] text-fl-ink",
  },
  row: { nt: "text-base font-black text-fl-ink", num: "text-base font-black text-fl-ink" },
  // Home marquee tile: kept from v2 (serif numerals).
  tile: {
    nt: "text-[11px] font-medium text-fl-muted",
    num: "font-num text-[28px] leading-8 font-semibold tracking-[-0.01em] text-fl-ink lining-nums",
  },
} as const;

export function Price({
  item,
  size,
  className = "",
}: {
  item: DailyFlightItem;
  size: keyof typeof PRICE_STYLE;
  className?: string;
}) {
  const style = PRICE_STYLE[size];
  return (
    <span className={`flex items-baseline whitespace-nowrap tabular-nums ${className}`}>
      <span className={style.nt}>NT$</span>
      <span className={style.num}>{item.priceTwd.toLocaleString("en-US")}</span>
    </span>
  );
}

function RedEyePill() {
  return (
    <span className="shrink-0 rounded-full bg-[#334155] px-2 py-0.5 text-[11px] leading-4 font-semibold whitespace-nowrap text-white">
      {t("flights.badge.redEyeText")}
    </span>
  );
}

function Dot() {
  return (
    <span aria-hidden="true" className="text-[#94a3b8]">
      {" · "}
    </span>
  );
}

/** `直飛` or `轉 N`, N being the worse leg's stops. */
function stopsText(fare: DailyFlightItem): string {
  const stops = fareStops(fare);
  if (stops === 0) return t("flights.badge.direct");
  return t(stops === 1 ? "flights.badge.stops" : "flights.badge.stops.many", { count: stops });
}

function fareCountText(count: number): string {
  return t(count === 1 ? "flights.count.one" : "flights.count", { count });
}

/** Row detail line: `高雄出發 · 航司 · 直飛 | 轉 N`; wraps, never truncates. */
function rowDetail(fare: DailyFlightItem, lang: Language): ReactNode[] {
  const stops = fareStops(fare);
  return [
    t("flights.fromOrigin", { city: flightOriginCityLabel(fare.origin, lang) }),
    airlineLabel(fare, lang),
    <span key="stops" className={`font-bold ${stops === 0 ? "text-fl-green" : "text-[#92400e]"}`}>
      {stopsText(fare)}
    </span>,
  ];
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
    <div
      className={`flight-card overflow-hidden rounded-[22px] border bg-white ${
        open
          ? "border-[#c4e3d3] shadow-[0_1px_2px_rgb(16_60_42/0.05),0_12px_26px_-10px_rgb(4_120_87/0.24)]"
          : "border-fl-hair-soft shadow-[0_1px_2px_rgb(16_60_42/0.05),0_10px_22px_-10px_rgb(16_60_42/0.16)]"
      }`}
    >
      <h2 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => {
            setOpen((prev) => !prev);
          }}
          className="press-card flex w-full min-w-0 cursor-pointer items-center gap-3 p-4 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-fl-green"
        >
          <CountryFlag countryCode={dest.countryCode} className="size-11 shrink-0" />
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
              <span className="flight-card-city max-w-full min-w-0 truncate text-[17px] leading-6 font-bold whitespace-nowrap text-fl-ink">
                {flightCityLabel(cheapest, lang)}
              </span>
              <RouteChip item={cheapest} />
              {cheapest.isRedEye && <RedEyePill />}
            </span>
            {open ? (
              <span className="min-w-0 text-[13px] leading-[18px] text-[#56655f]">
                {airlineLabel(cheapest, lang)}
                <Dot />
                <span className="whitespace-nowrap">{stopsText(cheapest)}</span>
                <Dot />
                <span className="whitespace-nowrap">{fareCountText(fares.length)}</span>
              </span>
            ) : (
              <span className="flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px] whitespace-nowrap text-[#334155]">
                <span className="min-w-0 truncate font-medium">{airlineLabel(cheapest, lang)}</span>
                <Dot />
                <span className="shrink-0 rounded-full bg-[#eef2f0] px-2 py-px text-[11px] font-semibold text-fl-muted">
                  {fareCountText(fares.length)}
                </span>
              </span>
            )}
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1.5">
            <Price item={cheapest} size="card" />
            <DealBadge item={cheapest} />
          </span>
          {open && (
            <span
              aria-hidden="true"
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-fl-tint text-fl-green"
            >
              <ChevronUp className="size-4" strokeWidth={2.2} />
            </span>
          )}
        </button>
      </h2>

      {open && (
        <div id={panelId}>
          <ul>
            {shown.map((fare, index) => (
              <li
                key={fare.id}
                className={`min-w-0 border-t-[1.5px] border-dashed border-fl-hair ${index === 0 ? "bg-fl-tint" : "bg-white"}`}
              >
                <FlightBookAnchor
                  item={fare}
                  lang={lang}
                  className="flex w-full min-w-0 items-center justify-between gap-3 px-4 py-3.5 transition-colors hover:bg-fl-ink/[0.03] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-fl-green"
                >
                  <span className="flex min-w-0 flex-col gap-[7px]">
                    <span className="fare-row-date flex flex-wrap items-center gap-x-[7px] gap-y-1 text-[15px] leading-5 font-black text-fl-ink">
                      <Calendar
                        aria-hidden="true"
                        className="size-[15px] shrink-0 text-[#4f9c7f]"
                        strokeWidth={2.2}
                      />
                      <span className="whitespace-nowrap">
                        {formatFareDates(fare.outDate, fare.inDate)}
                      </span>
                      {fare.isRedEye && <RedEyePill />}
                    </span>
                    <span className="fare-row-detail flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] leading-[18px] text-fl-muted">
                      {rowDetail(fare, lang).map((part, i) => (
                        <Fragment key={i}>
                          {i > 0 && <Dot />}
                          {part}
                        </Fragment>
                      ))}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2.5">
                    <span className="flex flex-col items-end gap-1">
                      <Price item={fare} size="row" />
                      <DealBadge item={fare} size="row" />
                    </span>
                    <span
                      aria-hidden="true"
                      className="flex size-7 items-center justify-center rounded-full bg-[#dff3e9] text-fl-green"
                    >
                      <ArrowUpRight className="size-3.5" strokeWidth={2.2} />
                    </span>
                  </span>
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
              className="flex min-h-12 w-full cursor-pointer items-center justify-center gap-1 border-t-[1.5px] border-dashed border-fl-hair bg-white text-sm font-bold text-fl-green focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-fl-green"
            >
              {showAll ? t("flights.showLess") : t("flights.showAll", { count: fares.length })}
              {showAll ? (
                <ChevronUp aria-hidden="true" className="size-4" />
              ) : (
                <ChevronDown aria-hidden="true" className="size-4" />
              )}
            </button>
          )}
          <p className="m-0 border-t-[1.5px] border-dashed border-fl-hair bg-fl-paper px-4 pt-3 pb-3.5 text-[11px] leading-normal text-fl-muted">
            {t("flights.rowsNote")}
          </p>
        </div>
      )}
    </div>
  );
}
