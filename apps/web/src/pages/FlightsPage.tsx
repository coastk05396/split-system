import {
  type DailyFlightItem,
  filterDailyFlights,
  FLIGHT_ORIGINS,
  FLIGHT_REGIONS,
  FLIGHT_SORT_OPTIONS,
  FLIGHT_TRIP_TYPES,
  type FlightOrigin,
  type FlightRegion,
  type FlightSortBy,
  type FlightTripType,
  ORIGIN_META,
  sortDailyFlights,
} from "@split/shared";
import { ArrowDownUp, ExternalLink, PlaneTakeoff, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useDailyFlights } from "../flights/api.js";
import {
  FlightAirlineSummary,
  FlightBadges,
  FlightBookAnchor,
  flightDestinationLabel,
  tripGoHref,
} from "../flights/ui.js";
import { Loading } from "../groups/ui.js";
import { getLocale, type MessageId, t } from "../i18n/messages.js";
import { SproutMascot } from "../shell/SproutMascot.js";

const REGION_LABELS: Record<FlightRegion, MessageId> = {
  jp: "flights.region.jp",
  kr: "flights.region.kr",
  sea: "flights.region.sea",
  hkmo: "flights.region.hkmo",
  longhaul: "flights.region.longhaul",
};

const TRIP_TYPE_LABELS: Record<FlightTripType, MessageId> = {
  rt: "flights.tripType.rt",
  ow: "flights.tripType.ow",
};

const SORT_LABELS: Record<FlightSortBy, MessageId> = {
  price: "flights.sort.price",
  discount: "flights.sort.discount",
};

/** Public + authed daily cheap flights radar (SPEC §6). */
export function FlightsPage() {
  const locale = getLocale();
  const query = useDailyFlights();
  const [region, setRegion] = useState<FlightRegion | "all">("all");
  const [origin, setOrigin] = useState<FlightOrigin | "all">("all");
  const [month, setMonth] = useState<string>("all");
  const [tripType, setTripType] = useState<FlightTripType | "all">("all");
  const [directOnly, setDirectOnly] = useState(false);
  const [holidayOnly, setHolidayOnly] = useState(false);
  const [sortBy, setSortBy] = useState<FlightSortBy>("price");

  function resetFilters() {
    setRegion("all");
    setOrigin("all");
    setMonth("all");
    setTripType("all");
    setDirectOnly(false);
    setHolidayOnly(false);
    setSortBy("price");
  }

  if (query.isPending) return <Loading />;

  const data = query.data;
  const items: readonly DailyFlightItem[] = data.items;
  const availableMonths = Array.from(new Set(items.map((item) => item.outDate.slice(0, 7)))).sort();
  const filtered = filterDailyFlights(items, {
    region,
    origin,
    tripType,
    month,
    directOnly,
    holidayOnly,
  });
  const sorted = sortDailyFlights(filtered, sortBy);

  return (
    <div className="flex flex-col gap-5 pb-8">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-sprout-100 text-sprout-700">
              <PlaneTakeoff aria-hidden="true" className="size-5" />
            </span>
            <div>
              <h1 className="text-2xl font-bold text-ink md:text-3xl">{t("flights.title")}</h1>
              <p className="text-sm text-ink-muted">{t("flights.subtitle")}</p>
            </div>
          </div>
          <span className="rounded-full border border-sprout-200 bg-white px-3 py-1 text-xs font-semibold text-sprout-700 tabular-nums">
            {t("flights.updatedAt", { date: data.date })}
          </span>
        </div>
        {data.isFallback && (
          <p className="rounded-2xl bg-peach/60 px-3.5 py-2 text-xs font-medium text-sprout-900">
            {t("flights.fallbackNote")}
          </p>
        )}
      </header>

      <section
        aria-label={t("flights.regionLabel")}
        className="surface-card flex flex-col gap-3 rounded-3xl border border-sprout-200/80 bg-white p-4 shadow-2xs"
      >
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label={t("flights.regionLabel")}
        >
          <FilterChip
            active={region === "all"}
            onClick={() => {
              setRegion("all");
            }}
          >
            {t("flights.region.all")}
          </FilterChip>
          {FLIGHT_REGIONS.map((r) => (
            <FilterChip
              key={r}
              active={region === r}
              onClick={() => {
                setRegion(r);
              }}
            >
              {t(REGION_LABELS[r])}
            </FilterChip>
          ))}
        </div>

        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label={t("flights.originLabel")}
        >
          <FilterChip
            active={origin === "all"}
            onClick={() => {
              setOrigin("all");
            }}
          >
            {t("flights.originAll")}
          </FilterChip>
          {FLIGHT_ORIGINS.map((o) => {
            const meta = ORIGIN_META[o];
            return (
              <FilterChip
                key={o}
                active={origin === o}
                onClick={() => {
                  setOrigin(o);
                }}
              >
                {locale === "en" ? `${o} ${meta.shortEn}` : `${meta.shortZhTW} ${o}`}
              </FilterChip>
            );
          })}
        </div>

        {availableMonths.length > 0 && (
          <div
            className="flex flex-wrap items-center gap-1.5"
            role="group"
            aria-label={t("flights.monthLabel")}
          >
            <FilterChip
              active={month === "all"}
              onClick={() => {
                setMonth("all");
              }}
            >
              {t("flights.monthAll")}
            </FilterChip>
            {availableMonths.map((ym) => (
              <FilterChip
                key={ym}
                active={month === ym}
                onClick={() => {
                  setMonth(ym);
                }}
              >
                {ym}
              </FilterChip>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-sprout-100 pt-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <FilterChip
              active={tripType === "all"}
              onClick={() => {
                setTripType("all");
              }}
            >
              {t("flights.tripType.all")}
            </FilterChip>
            {FLIGHT_TRIP_TYPES.map((tt) => (
              <FilterChip
                key={tt}
                active={tripType === tt}
                onClick={() => {
                  setTripType(tt);
                }}
              >
                {t(TRIP_TYPE_LABELS[tt])}
              </FilterChip>
            ))}
            <FilterChip
              active={directOnly}
              onClick={() => {
                setDirectOnly((prev) => !prev);
              }}
            >
              {t("flights.directOnly")}
            </FilterChip>
            <FilterChip
              active={holidayOnly}
              onClick={() => {
                setHolidayOnly((prev) => !prev);
              }}
            >
              {t("flights.holidayOnly")}
            </FilterChip>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted">
              <ArrowDownUp aria-hidden="true" className="size-3.5" />
              {t("flights.sortLabel")}
            </span>
            <div
              className="flex items-center gap-1"
              role="group"
              aria-label={t("flights.sortLabel")}
            >
              {FLIGHT_SORT_OPTIONS.map((option) => (
                <FilterChip
                  key={option}
                  active={sortBy === option}
                  onClick={() => {
                    setSortBy(option);
                  }}
                >
                  {t(SORT_LABELS[option])}
                </FilterChip>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="flex items-center justify-between text-xs font-semibold text-ink-muted">
        <span className="tabular-nums">{t("flights.count", { count: sorted.length })}</span>
      </div>

      {sorted.length === 0 ? (
        <div className="surface-card flex flex-col items-center gap-3 rounded-3xl border border-sprout-200/80 bg-white px-6 py-10 text-center">
          <SproutMascot className="size-20" mood="happy" />
          <h2 className="text-lg font-bold text-ink">{t("flights.empty.title")}</h2>
          <p className="max-w-sm text-sm text-ink-muted">{t("flights.empty.body")}</p>
          <button
            type="button"
            onClick={resetFilters}
            className="press-pill mt-1 inline-flex cursor-pointer items-center gap-2 rounded-full bg-sprout-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-sprout-600"
          >
            <RotateCcw aria-hidden="true" className="size-4" />
            {t("flights.empty.reset")}
          </button>
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {sorted.map((item) => {
            const dest = flightDestinationLabel(item, locale);
            return (
              <li key={item.id}>
                <article className="surface-card flex h-full flex-col justify-between gap-3 rounded-3xl border border-sprout-200/80 bg-white p-4 shadow-2xs transition-colors hover:border-sprout-300">
                  <div className="flex flex-col gap-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <a
                        href={tripGoHref(item, locale)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex min-w-0 items-center gap-2.5"
                      >
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-sprout-50 text-xl">
                          <span aria-hidden="true">{dest.flag}</span>
                        </span>
                        <div className="min-w-0">
                          <h2 className="truncate text-base font-bold text-ink group-hover:text-sprout-700">
                            {dest.city}
                          </h2>
                          <p className="text-xs font-semibold tracking-wide text-ink-muted tabular-nums">
                            {item.origin} → {item.dest}
                          </p>
                        </div>
                      </a>
                    </div>

                    <FlightBadges item={item} lang={locale} />

                    <p className="text-xs text-ink-muted">
                      <FlightAirlineSummary item={item} lang={locale} />
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-3 border-t border-sprout-100 pt-3">
                    <p className="text-xl font-bold text-sprout-900 tabular-nums">
                      NT$ {item.priceTwd.toLocaleString("en-US")}
                    </p>
                    <FlightBookAnchor
                      item={item}
                      lang={locale}
                      className="press-pill inline-flex items-center gap-1.5 rounded-full bg-sprout-900 px-3.5 py-2 text-xs font-bold text-white hover:bg-sprout-700"
                    >
                      <span>{t("flights.bookCta")}</span>
                      <ExternalLink aria-hidden="true" className="size-3.5" />
                    </FlightBookAnchor>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-center text-xs text-ink-muted">{t("flights.disclaimer")}</p>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`press-pill cursor-pointer rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${
        active
          ? "border-sprout-700 bg-sprout-700 text-white"
          : "border-sprout-200 bg-sprout-50/70 text-ink hover:border-sprout-300 hover:bg-sprout-100/70"
      }`}
    >
      {children}
    </button>
  );
}
