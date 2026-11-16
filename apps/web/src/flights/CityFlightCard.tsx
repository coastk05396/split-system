import { type DailyFlightItem, getAirlineName, type Language } from "@split/shared";
import { ChevronDown, ExternalLink, Moon } from "lucide-react";
import { useId, useState } from "react";
import { t } from "../i18n/messages.js";
import { CountryFlag } from "./CountryFlag.js";
import type { CityGroup } from "./groups.js";
import { FlightBookAnchor, flightCityLabel, flightDestinationLabel } from "./ui.js";

const SECONDARY_TEXT = "text-slate-700";

function routeText(item: DailyFlightItem): string {
  return `${item.origin} ${item.tripType === "rt" ? "⇄" : "→"} ${item.dest}`;
}

function directness(item: DailyFlightItem): string {
  const maxStops = Math.max(item.transfers, item.returnTransfers ?? 0);
  return maxStops === 0
    ? t("flights.badge.direct")
    : t(maxStops === 1 ? "flights.badge.stops" : "flights.badge.stops.many", { count: maxStops });
}

function airlineLabel(item: DailyFlightItem, lang: Language): string {
  return getAirlineName(item.airlines[0] ?? "", lang);
}

function shortDate(iso: string): string {
  return iso.slice(5).replace("-", "/");
}

/** Discount display: solid pill from 40%, plain `省 X%` for 15-39%, plain `↓X%` for 1-14%, else nothing. */
const SOLID_BADGE_MIN_PCT = 40;
const SIGNAL_MIN_PCT = 15;
const BADGE_TEXT =
  "mt-1 inline-block text-[13px] leading-4 font-semibold whitespace-nowrap tabular-nums";

function DealBadge({ item }: { item: DailyFlightItem }) {
  const pct = item.discountPct;
  if (pct <= 0) return null;
  if (pct >= SOLID_BADGE_MIN_PCT) {
    return (
      <span className="mt-1 inline-block rounded-full bg-sprout-600 px-2 py-px text-[13px] leading-4 font-semibold whitespace-nowrap text-white tabular-nums">
        {t("flights.deal.save", { pct })}
      </span>
    );
  }
  if (pct >= SIGNAL_MIN_PCT) {
    return (
      <span className={`${BADGE_TEXT} text-sprout-700`}>{t("flights.deal.save", { pct })}</span>
    );
  }
  return (
    <span className={`${BADGE_TEXT} text-sprout-700`}>
      <span aria-hidden="true">{`↓${String(pct)}%`}</span>
      <span className="sr-only">{t("flights.deal.below", { pct })}</span>
    </span>
  );
}

function Price({ item, small = false }: { item: DailyFlightItem; small?: boolean }) {
  return (
    <span className="flex items-baseline justify-end gap-0.5">
      <span className="text-xs font-semibold text-slate-400">NT$</span>
      <span
        className={`${small ? "text-lg" : "text-[26px]"} leading-none font-black tracking-tight text-slate-900 tabular-nums`}
      >
        {item.priceTwd.toLocaleString("en-US")}
      </span>
    </span>
  );
}

/** One destination: collapsed summary of its cheapest fare; tap to list every fare. */
export function CityFlightCard({ group, lang }: { group: CityGroup; lang: Language }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const { cheapest } = group;
  const dest = flightDestinationLabel(cheapest, lang);

  return (
    <div className="flight-card rounded-2xl border border-slate-200/85 bg-white shadow-2xs">
      <h2 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => {
            setOpen((prev) => !prev);
          }}
          className="press-card flex min-h-[82px] w-full min-w-0 cursor-pointer items-center gap-2 rounded-2xl px-3 py-3 text-left sm:gap-2.5 sm:px-3.5 sm:py-3.5"
        >
          <CountryFlag
            countryCode={dest.countryCode}
            className="size-8 shrink-0 shadow-2xs sm:size-9"
          />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 overflow-hidden">
              <span className="flight-card-city truncate text-xl font-bold text-slate-900">
                {flightCityLabel(cheapest, lang)}
              </span>
              <span className="flight-card-route max-w-full truncate rounded-full bg-sprout-50 px-1.5 py-0.5 text-xs font-extrabold tracking-tight whitespace-nowrap text-sprout-700 tabular-nums min-[360px]:px-2 min-[360px]:text-[15px]">
                {routeText(cheapest)}
              </span>
              {cheapest.isRedEye && <RedEye />}
            </span>
            <span
              className={`mt-1 flex min-w-0 items-center text-[13px] whitespace-nowrap ${SECONDARY_TEXT}`}
            >
              <span className="min-w-0 truncate">{airlineLabel(cheapest, lang)}</span>
              <span className="shrink-0">
                {`\u00A0· ${directness(cheapest)} · ${t(
                  group.fares.length === 1 ? "flights.groupCount.one" : "flights.groupCount",
                  {
                    count: group.fares.length,
                  },
                )}`}
              </span>
            </span>
          </span>
          <span className="shrink-0 text-right">
            <Price item={cheapest} />
            <DealBadge item={cheapest} />
          </span>
          <ChevronDown
            aria-hidden="true"
            className={`size-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </h2>

      {open && (
        <ul id={panelId} className="divide-y divide-slate-100 border-t border-slate-100">
          {group.fares.map((fare, index) => (
            <li key={fare.id} className="min-w-0">
              <FlightBookAnchor
                item={fare}
                lang={lang}
                className={`flex min-h-16 w-full min-w-0 items-center gap-2 px-3 py-3 transition-colors hover:bg-slate-50/80 sm:px-3.5 ${
                  index === 0 ? "bg-sprout-50" : ""
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold whitespace-nowrap text-slate-900 tabular-nums">
                    {fare.inDate === null
                      ? shortDate(fare.outDate)
                      : `${shortDate(fare.outDate)} – ${shortDate(fare.inDate)}`}
                  </span>
                  <span
                    className={`mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] ${SECONDARY_TEXT}`}
                  >
                    <span className="shrink-0 rounded-full bg-sprout-50 px-1.5 py-0.5 text-xs font-bold text-sprout-700 tabular-nums">
                      {routeText(fare)}
                    </span>
                    <span className="min-w-0 truncate">{airlineLabel(fare, lang)}</span>
                    <span className="shrink-0">
                      {`\u00A0· ${directness(fare)}`}
                      {fare.isRedEye && ` · ${t("flights.badge.redEyeText")}`}
                    </span>
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <Price item={fare} small />
                  <DealBadge item={fare} />
                </span>
                <ExternalLink aria-hidden="true" className="size-3.5 shrink-0 text-slate-400" />
              </FlightBookAnchor>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RedEye() {
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap text-indigo-700">
      <Moon aria-hidden="true" className="size-2.5" />
      <span className="sr-only sm:not-sr-only">{t("flights.badge.redEyeText")}</span>
    </span>
  );
}
