import {
  type DailyFlightItem,
  type DailyFlightsFilter,
  filterDailyFlights,
  FLIGHT_ORIGINS,
  type FlightOrigin,
  type FlightStopsFilter,
  getAirlineName,
  type Language,
  ORIGIN_META,
} from "@split/shared";
import * as Dialog from "@radix-ui/react-dialog";
import { ListFilter, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { useDailyFlights } from "../flights/api.js";
import { type FlightArea, FLIGHT_AREAS, flightAreaOf } from "../flights/areas.js";
import { CityFlightCard } from "../flights/CityFlightCard.js";
import { groupByCity } from "../flights/groups.js";
import { FlightsTitle } from "../flights/FlightsTitle.js";
import { flightsUpdatedNote } from "../flights/ui.js";
import { Loading } from "../groups/ui.js";
import { getLocale, type MessageId, t } from "../i18n/messages.js";
import { SproutMascot } from "../shell/SproutMascot.js";

const AREA_LABELS: Record<FlightArea, MessageId> = {
  jp: "flights.area.jp",
  kr: "flights.area.kr",
  hkcn: "flights.area.hkcn",
  sea: "flights.area.sea",
  europe: "flights.area.europe",
  na: "flights.area.na",
  anz: "flights.area.anz",
  me: "flights.area.me",
};

const BUDGET_CAPS = [5000, 10000] as const;

const STOPS_OPTIONS: ReadonlyArray<{ value: FlightStopsFilter; label: MessageId }> = [
  { value: "all", label: "flights.stops.all" },
  { value: "direct", label: "flights.stops.direct" },
  { value: "transfer", label: "flights.stops.transfer" },
];

const EN_MONTH_SHORT = [
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

function formatMonthChip(ym: string, lang: Language): string {
  const [year, monthStr] = ym.split("-");
  const monthNum = Number(monthStr);
  if (!year || !Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12) return ym;
  if (lang === "en") return EN_MONTH_SHORT[monthNum - 1] ?? ym;
  return `${monthNum}月`;
}

function collectMonthOptions(items: readonly DailyFlightItem[]): string[] {
  const months = new Set<string>();
  for (const item of items) {
    if (item.outDate.length >= 7) months.add(item.outDate.slice(0, 7));
  }
  return [...months].sort();
}

// RMQ/TNN left discovery (ADR 0013) but old fares and the curated fallback may still carry them.
const RETIRED_ORIGINS: ReadonlySet<string> = new Set(["RMQ", "TNN"]);

/** Origins that have a fare on the board (the filter never offers an empty origin), in `FLIGHT_ORIGINS` order. */
function collectOriginOptions(items: readonly DailyFlightItem[]): FlightOrigin[] {
  const present = new Set<string>(items.map((item) => item.origin));
  return FLIGHT_ORIGINS.filter((o) => present.has(o) && !RETIRED_ORIGINS.has(o));
}

/** Every carrier of every fare (a multi-airline fare lists all of them), one option per carrier. */
function collectAirlineOptions(
  items: readonly DailyFlightItem[],
  lang: Language,
): Array<{ code: string; label: string }> {
  const seen = new Map<string, string>();
  for (const item of items) {
    for (const raw of item.airlines) {
      if (!seen.has(raw.toUpperCase())) seen.set(raw.toUpperCase(), getAirlineName(raw, lang));
    }
  }
  return [...seen].sort(([a], [b]) => (a < b ? -1 : 1)).map(([code, label]) => ({ code, label }));
}

/** Public + authed daily cheap flights radar (SPEC §6). */
export function FlightsPage({ standalone = false }: { standalone?: boolean }) {
  const locale = getLocale();
  const query = useDailyFlights();
  const [area, setArea] = useState<FlightArea | "all">("all");
  const [origin, setOrigin] = useState<FlightOrigin | "all">("all");
  const [month, setMonth] = useState<string>("all");
  const [airline, setAirline] = useState<string>("all");
  const [stops, setStops] = useState<FlightStopsFilter>("all");
  const [maxPriceTwd, setMaxPriceTwd] = useState<number | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  function resetDrawerFilters() {
    setOrigin("all");
    setArea("all");
    setMonth("all");
    setAirline("all");
    setStops("all");
    setMaxPriceTwd(null);
  }

  if (query.isPending) return <Loading />;

  const data = query.data;
  const items: readonly DailyFlightItem[] = data.items;
  const currentFilter: DailyFlightsFilter = {
    region: "all",
    origin,
    tripType: "rt",
    month,
    airline,
    directOnly: false,
    stops,
    holidayOnly: false,
    maxPriceTwd,
  };
  /** Fares matching `patch` on top of the current filters and, by default, the chosen area. */
  function visibleWith(patch: Partial<DailyFlightsFilter>, inArea = area): DailyFlightItem[] {
    const list = filterDailyFlights(items, { ...currentFilter, ...patch });
    return inArea === "all" ? list : list.filter((item) => flightAreaOf(item.dest) === inArea);
  }

  const filtered = visibleWith({});
  const groups = groupByCity(filtered);
  const monthOptions = collectMonthOptions(items);
  const airlineOptions = collectAirlineOptions(items, locale);
  const originOptions = collectOriginOptions(items);

  function countWith(patch: Partial<DailyFlightsFilter>, inArea = area): number {
    return visibleWith(patch, inArea).length;
  }

  const activeDrawerCount =
    (origin !== "all" ? 1 : 0) +
    (area !== "all" ? 1 : 0) +
    (month !== "all" ? 1 : 0) +
    (airline !== "all" ? 1 : 0) +
    (stops !== "all" ? 1 : 0) +
    (maxPriceTwd !== null ? 1 : 0);

  return (
    <div className="font-flights flex min-w-0 flex-col gap-3 pb-8">
      {!standalone && (
        <header className="px-1 pt-4 pb-1">
          <FlightsTitle note />
        </header>
      )}

      <div className="flex items-center justify-between gap-2">
        <p
          data-testid="flights-count"
          className="text-xs whitespace-nowrap text-fl-muted tabular-nums"
        >
          {t(filtered.length === 1 ? "flights.count.one" : "flights.count", {
            count: filtered.length,
          })}
        </p>
        <Dialog.Root open={filtersOpen} onOpenChange={setFiltersOpen}>
          <Dialog.Trigger asChild>
            <button
              type="button"
              className="press-pill inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border-[1.5px] border-[#a9d6c1] bg-white px-3.5 text-sm font-bold text-fl-green focus-visible:outline-2 focus-visible:outline-fl-green"
            >
              <ListFilter aria-hidden="true" className="size-4" strokeWidth={2} />
              <span>{t("flights.filtersBtn")}</span>
              {activeDrawerCount > 0 && (
                <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-fl-green text-[11px] font-bold text-white tabular-nums">
                  {activeDrawerCount}
                </span>
              )}
            </button>
          </Dialog.Trigger>

          <Dialog.Portal>
            <Dialog.Overlay className="dialog-overlay fixed inset-0 z-40 bg-[rgb(15_23_42/0.45)]" />
            <Dialog.Content className="font-flights dialog-content dialog-sheet fixed inset-x-0 bottom-0 z-50 flex max-h-[82dvh] flex-col overflow-hidden rounded-t-[28px] bg-fl-paper text-fl-ink shadow-2xl md:inset-x-4 md:top-1/2 md:bottom-auto md:mx-auto md:max-h-[85dvh] md:max-w-lg md:-translate-y-1/2 md:rounded-3xl">
              <div
                aria-hidden="true"
                className="mx-auto mt-3 h-[5px] w-11 shrink-0 rounded-full bg-[#c9dad1] md:hidden"
              />
              <div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-3 md:px-6 md:pt-5">
                <Dialog.Title className="text-lg font-black text-fl-ink">
                  {t("flights.filtersTitle")}
                </Dialog.Title>
                <Dialog.Description className="sr-only">
                  {t("flights.filtersTitle")}
                </Dialog.Description>
                <Dialog.Close
                  aria-label={t("flights.filtersClose")}
                  className="press-icon flex size-11 cursor-pointer items-center justify-center rounded-full bg-fl-track text-fl-muted focus-visible:outline-2 focus-visible:outline-fl-green"
                >
                  <X aria-hidden="true" className="size-[18px]" strokeWidth={2.2} />
                </Dialog.Close>
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-4 py-[18px] md:px-6">
                <FilterSection label={t("flights.originLabel")}>
                  <FilterChip
                    active={origin === "all"}
                    count={countWith({ origin: "all" })}
                    onClick={() => {
                      setOrigin("all");
                    }}
                  >
                    {t("flights.originAll")}
                  </FilterChip>
                  {originOptions.map((o) => {
                    const meta = ORIGIN_META[o];
                    return (
                      <FilterChip
                        key={o}
                        active={origin === o}
                        count={countWith({ origin: o })}
                        onClick={() => {
                          setOrigin(o);
                        }}
                      >
                        {`${locale === "en" ? meta.shortEn : meta.shortZhTW} ${o}`}
                      </FilterChip>
                    );
                  })}
                </FilterSection>

                <FilterSection label={t("flights.destLabel")}>
                  <FilterChip
                    active={area === "all"}
                    count={countWith({}, "all")}
                    onClick={() => {
                      setArea("all");
                    }}
                  >
                    {t("flights.region.all")}
                  </FilterChip>
                  {FLIGHT_AREAS.map((a) => (
                    <FilterChip
                      key={a}
                      active={area === a}
                      count={countWith({}, a)}
                      onClick={() => {
                        setArea((prev) => (prev === a ? "all" : a));
                      }}
                    >
                      {t(AREA_LABELS[a])}
                    </FilterChip>
                  ))}
                </FilterSection>

                <FilterSection label={t("flights.monthLabel")}>
                  <FilterChip
                    active={month === "all"}
                    count={countWith({ month: "all" })}
                    onClick={() => {
                      setMonth("all");
                    }}
                  >
                    {t("flights.monthAll")}
                  </FilterChip>
                  {monthOptions.map((ym) => (
                    <FilterChip
                      key={ym}
                      active={month === ym}
                      count={countWith({ month: ym })}
                      onClick={() => {
                        setMonth((prev) => (prev === ym ? "all" : ym));
                      }}
                    >
                      {formatMonthChip(ym, locale)}
                    </FilterChip>
                  ))}
                </FilterSection>

                <FilterSection label={t("flights.stopsLabel")}>
                  {STOPS_OPTIONS.map((option) => (
                    <FilterChip
                      key={option.value}
                      active={stops === option.value}
                      count={countWith({ stops: option.value })}
                      onClick={() => {
                        setStops(option.value);
                      }}
                    >
                      {t(option.label)}
                    </FilterChip>
                  ))}
                </FilterSection>

                <FilterSection label={t("flights.airlineLabel")}>
                  <FilterChip
                    active={airline === "all"}
                    count={countWith({ airline: "all" })}
                    onClick={() => {
                      setAirline("all");
                    }}
                  >
                    {t("flights.airlineAll")}
                  </FilterChip>
                  {airlineOptions.map((option) => (
                    <FilterChip
                      key={option.code}
                      active={airline === option.code}
                      count={countWith({ airline: option.code })}
                      onClick={() => {
                        setAirline((prev) => (prev === option.code ? "all" : option.code));
                      }}
                    >
                      {option.label}
                    </FilterChip>
                  ))}
                </FilterSection>

                <FilterSection label={t("flights.budgetLabel")}>
                  <FilterChip
                    active={maxPriceTwd === null}
                    count={countWith({ maxPriceTwd: null })}
                    onClick={() => {
                      setMaxPriceTwd(null);
                    }}
                  >
                    {t("flights.budgetAll")}
                  </FilterChip>
                  {BUDGET_CAPS.map((cap) => (
                    <FilterChip
                      key={cap}
                      active={maxPriceTwd === cap}
                      count={countWith({ maxPriceTwd: cap })}
                      onClick={() => {
                        setMaxPriceTwd((prev) => (prev === cap ? null : cap));
                      }}
                    >
                      {t("flights.budgetUnder", { amount: cap.toLocaleString("en-US") })}
                    </FilterChip>
                  ))}
                </FilterSection>
              </div>

              <div className="flex shrink-0 items-center gap-2.5 px-4 pt-3 pb-[max(1.25rem,calc(env(safe-area-inset-bottom)+0.75rem))] md:px-6 md:pb-5">
                <button
                  type="button"
                  onClick={resetDrawerFilters}
                  className="press-pill min-h-[50px] shrink-0 cursor-pointer rounded-full border-[1.5px] border-[#cbd5e1] bg-white px-[22px] text-[15px] font-semibold text-fl-ink focus-visible:outline-2 focus-visible:outline-fl-green"
                >
                  {t("flights.filtersReset")}
                </button>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="press-pill min-h-[50px] min-w-0 flex-1 cursor-pointer rounded-full bg-fl-green px-4 text-[15px] font-bold text-white shadow-[0_8px_16px_-6px_rgb(4_120_87/0.45)] tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fl-green"
                  >
                    {t("flights.filtersApplyCount", { count: filtered.length })}
                  </button>
                </Dialog.Close>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-3xl border border-slate-200/80 bg-white px-6 py-10 text-center shadow-2xs">
          <SproutMascot className="size-20" mood="happy" />
          <h2 className="text-lg font-bold text-ink">{t("flights.empty.title")}</h2>
          <p className="max-w-sm text-sm text-ink-muted">{t("flights.empty.body")}</p>
          <button
            type="button"
            onClick={resetDrawerFilters}
            className="press-pill mt-1 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full bg-sprout-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-sprout-600"
          >
            <RotateCcw aria-hidden="true" className="size-4" />
            {t("flights.empty.reset")}
          </button>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {groups.map((group) => (
            <li key={group.cityKey} className="min-w-0">
              <CityFlightCard group={group} lang={locale} />
            </li>
          ))}
        </ul>
      )}

      <p className="text-center text-xs text-fl-muted">
        {flightsUpdatedNote(data.date, data.isFallback)}
      </p>
      <p className="-mt-3 text-center text-xs text-fl-muted">{t("flights.priceNote")}</p>
    </div>
  );
}

function FilterSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-[9px]">
      <span className="text-[13px] font-bold text-fl-sub">{label}</span>
      <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count?: number;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`press-pill inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full border-[1.5px] px-[15px] text-sm transition-colors focus-visible:outline-2 focus-visible:outline-fl-green ${
        active
          ? "border-fl-green bg-fl-tint font-bold text-fl-green"
          : "border-fl-hair bg-white font-medium text-fl-sub"
      }`}
    >
      <span>{children}</span>
      {count !== undefined && (
        <span
          className={`text-[11px] font-medium tabular-nums ${
            active ? "text-fl-green" : "text-fl-muted"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}
