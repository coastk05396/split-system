import {
  type DailyFlightItem,
  type DailyFlightsFilter,
  filterDailyFlights,
  FLIGHT_ORIGINS,
  FLIGHT_REGIONS,
  type FlightOrigin,
  type FlightRegion,
  type FlightTripType,
  getAirlineName,
  type Language,
  ORIGIN_META,
} from "@split/shared";
import * as Dialog from "@radix-ui/react-dialog";
import { RotateCcw, SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";
import { useDailyFlights } from "../flights/api.js";
import { CityFlightCard } from "../flights/CityFlightCard.js";
import { groupByCity } from "../flights/groups.js";
import { FlightsIconTile, FlightsTitle } from "../flights/FlightsTitle.js";
import { flightDestinationLabel, flightsUpdatedNote } from "../flights/ui.js";
import { Loading } from "../groups/ui.js";
import { getLocale, type MessageId, t } from "../i18n/messages.js";
import { SelectionPill } from "../shell/SelectionPill.js";
import { SproutMascot } from "../shell/SproutMascot.js";

const REGION_LABELS: Record<FlightRegion, MessageId> = {
  jp: "flights.region.jp",
  kr: "flights.region.kr",
  sea: "flights.region.sea",
  hkmo: "flights.region.hkmo",
  longhaul: "flights.region.longhaul",
};

const BUDGET_CAPS = [5000, 8000, 12000, 20000] as const;

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
  if (lang === "en") return `${EN_MONTH_SHORT[monthNum - 1] ?? monthStr} ${year}`;
  return `${year}年${monthNum}月`;
}

function collectDestinationOptions(
  items: readonly DailyFlightItem[],
  region: FlightRegion | "all",
  selectedDest: string,
  lang: Language,
): Array<{ code: string; label: string }> {
  const seen = new Map<string, string>();
  for (const item of items) {
    const code = item.dest.toUpperCase();
    if (seen.has(code)) continue;
    if (region !== "all" && item.region !== region && code !== selectedDest) continue;
    seen.set(code, flightDestinationLabel(item, lang).city);
  }
  return [...seen.entries()].map(([code, label]) => ({ code, label }));
}

function collectMonthOptions(items: readonly DailyFlightItem[]): string[] {
  const months = new Set<string>();
  for (const item of items) {
    if (item.outDate.length >= 7) months.add(item.outDate.slice(0, 7));
  }
  return [...months].sort();
}

function collectAirlineOptions(
  items: readonly DailyFlightItem[],
  lang: Language,
): Array<{ code: string; label: string }> {
  const seen = new Set<string>();
  for (const item of items) {
    for (const raw of item.airlines) {
      seen.add(raw.toUpperCase());
    }
  }
  return [...seen].sort().map((code) => ({ code, label: getAirlineName(code, lang) }));
}

/** Public + authed daily cheap flights radar (SPEC §6). */
export function FlightsPage({ standalone = false }: { standalone?: boolean }) {
  const locale = getLocale();
  const query = useDailyFlights();
  const [region, setRegion] = useState<FlightRegion | "all">("all");
  const [origin, setOrigin] = useState<FlightOrigin | "all">("all");
  const [dest, setDest] = useState<string>("all");
  const [tripType, setTripType] = useState<FlightTripType | null>(null);
  const [month, setMonth] = useState<string>("all");
  const [airline, setAirline] = useState<string>("all");
  const [directOnly, setDirectOnly] = useState(false);
  const [maxPriceTwd, setMaxPriceTwd] = useState<number | null>(null);
  const [excludeRedEye, setExcludeRedEye] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  function resetDrawerFilters() {
    setOrigin("all");
    setDest("all");
    setMonth("all");
    setAirline("all");
    setDirectOnly(false);
    setMaxPriceTwd(null);
    setExcludeRedEye(false);
  }

  function resetFilters() {
    setRegion("all");
    setTripType(null);
    resetDrawerFilters();
  }

  if (query.isPending) return <Loading />;

  const data = query.data;
  const items: readonly DailyFlightItem[] = data.items;
  // 來回 is the default tab; boards with no round trips open on 單程 instead of an empty list.
  const activeTripType: FlightTripType =
    tripType ?? (items.some((item) => item.tripType === "rt") ? "rt" : "ow");
  const currentFilter: DailyFlightsFilter = {
    region,
    origin,
    dest,
    tripType: activeTripType,
    month,
    airline,
    directOnly,
    holidayOnly: false,
    maxPriceTwd,
    excludeRedEye,
  };
  const filtered = filterDailyFlights(items, currentFilter);
  const groups = groupByCity(filtered);
  const destOptions = collectDestinationOptions(items, region, dest, locale);
  const monthOptions = collectMonthOptions(items);
  const airlineOptions = collectAirlineOptions(items, locale);

  function selectRegion(next: FlightRegion | "all") {
    setRegion(next);
    if (
      dest !== "all" &&
      next !== "all" &&
      !items.some((item) => item.dest.toUpperCase() === dest && item.region === next)
    ) {
      setDest("all");
    }
  }

  function countWith(patch: Partial<DailyFlightsFilter>): number {
    return filterDailyFlights(items, { ...currentFilter, ...patch }).length;
  }

  const activeDrawerCount =
    (origin !== "all" ? 1 : 0) +
    (dest !== "all" ? 1 : 0) +
    (month !== "all" ? 1 : 0) +
    (airline !== "all" ? 1 : 0) +
    (directOnly ? 1 : 0) +
    (maxPriceTwd !== null ? 1 : 0) +
    (excludeRedEye ? 1 : 0);

  return (
    <div className="flex min-w-0 flex-col gap-3 pb-8">
      {!standalone && (
        <header className="-mx-3 flex items-center gap-2.5 rounded-3xl bg-linear-to-b from-sprout-50 to-transparent px-3 pt-4 pb-1">
          <FlightsIconTile />
          <FlightsTitle />
        </header>
      )}

      <div
        data-testid="flights-top-bar"
        className="flex flex-nowrap items-end justify-between gap-3 border-b border-slate-200/80"
      >
        <div
          role="group"
          aria-label={t("flights.regionLabel")}
          className="scroll-fade-x flex min-w-0 flex-1 items-center gap-5 overflow-x-auto pr-4"
        >
          <RegionTab
            active={region === "all"}
            onClick={() => {
              selectRegion("all");
            }}
          >
            {t("flights.region.all")}
          </RegionTab>
          {FLIGHT_REGIONS.map((r) => (
            <RegionTab
              key={r}
              active={region === r}
              onClick={() => {
                selectRegion(r);
              }}
            >
              {t(REGION_LABELS[r])}
            </RegionTab>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex min-h-11 min-w-0 flex-1 items-center rounded-full bg-slate-100 p-1">
          {(["rt", "ow"] as const).map((type) => (
            <button
              key={type}
              type="button"
              aria-pressed={activeTripType === type}
              onClick={() => {
                setTripType(type);
              }}
              className={`press-pill min-h-9 flex-1 cursor-pointer rounded-full px-3 text-sm whitespace-nowrap transition-colors ${
                activeTripType === type
                  ? "bg-white font-bold text-sprout-700 shadow-sm"
                  : "font-medium text-slate-500"
              }`}
            >
              {t(type === "rt" ? "flights.tripType.rt" : "flights.tripType.ow")}
            </button>
          ))}
        </div>

        <Dialog.Root open={filtersOpen} onOpenChange={setFiltersOpen}>
          <Dialog.Trigger asChild>
            <button
              type="button"
              className="press-pill inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-sprout-500 bg-white px-4 text-sm font-bold text-sprout-700"
            >
              <SlidersHorizontal aria-hidden="true" className="size-4" />
              <span>{t("flights.filtersBtn")}</span>
              {activeDrawerCount > 0 && (
                <span className="inline-flex size-5 items-center justify-center rounded-full bg-sprout-500 text-[11px] font-bold text-white tabular-nums">
                  {activeDrawerCount}
                </span>
              )}
            </button>
          </Dialog.Trigger>

          <Dialog.Portal>
            <Dialog.Overlay className="dialog-overlay fixed inset-0 z-40 bg-slate-900/35 backdrop-blur-[2px]" />
            <Dialog.Content className="dialog-content dialog-sheet glass-dialog fixed inset-x-0 bottom-0 z-50 flex max-h-[82dvh] flex-col overflow-hidden rounded-t-[2rem] border-t border-slate-200 bg-white text-slate-900 shadow-2xl md:inset-x-4 md:top-1/2 md:bottom-auto md:mx-auto md:max-h-[85dvh] md:max-w-lg md:-translate-y-1/2 md:rounded-3xl md:border">
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-5 py-4 md:px-6">
                <Dialog.Title className="text-lg font-bold text-slate-900">
                  {t("flights.filtersTitle")}
                </Dialog.Title>
                <Dialog.Description className="sr-only">
                  {t("flights.filtersTitle")}
                </Dialog.Description>
                <Dialog.Close
                  aria-label={t("flights.filtersClose")}
                  className="press-icon rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X aria-hidden="true" className="size-4" />
                </Dialog.Close>
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4 md:px-6">
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
                  {FLIGHT_ORIGINS.map((o) => {
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
                        {locale === "en" ? meta.shortEn : meta.shortZhTW}
                      </FilterChip>
                    );
                  })}
                </FilterSection>

                <FilterSection label={t("flights.destLabel")}>
                  <FilterChip
                    active={dest === "all"}
                    count={countWith({ dest: "all" })}
                    onClick={() => {
                      setDest("all");
                    }}
                  >
                    {t("flights.destAll")}
                  </FilterChip>
                  {destOptions.map((option) => (
                    <FilterChip
                      key={option.code}
                      active={dest === option.code}
                      count={countWith({ dest: option.code })}
                      onClick={() => {
                        setDest((prev) => (prev === option.code ? "all" : option.code));
                      }}
                    >
                      {option.label}
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

                <FilterSection label={t("flights.stopsLabel")}>
                  <FilterChip
                    active={directOnly}
                    count={countWith({ directOnly: true })}
                    onClick={() => {
                      setDirectOnly((prev) => !prev);
                    }}
                  >
                    {t("flights.directOnly")}
                  </FilterChip>
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

                <FilterSection label={t("flights.extrasLabel")}>
                  <FilterChip
                    active={excludeRedEye}
                    count={countWith({ excludeRedEye: true })}
                    onClick={() => {
                      setExcludeRedEye((prev) => !prev);
                    }}
                  >
                    {t("flights.excludeRedEye")}
                  </FilterChip>
                </FilterSection>
              </div>

              <div className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-100 bg-white px-5 py-3.5 pb-[max(1.25rem,calc(env(safe-area-inset-bottom)+0.75rem))] md:px-6 md:pb-3.5">
                <button
                  type="button"
                  onClick={resetDrawerFilters}
                  className="press-pill inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
                >
                  <RotateCcw aria-hidden="true" className="size-3.5" />
                  <span>{t("flights.filtersReset")}</span>
                </button>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="press-pill cursor-pointer rounded-full bg-sprout-500 px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-sprout-600 tabular-nums"
                  >
                    {t("flights.filtersApplyCount", { count: filtered.length })}
                  </button>
                </Dialog.Close>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>

      <p className="text-xs font-medium text-slate-500 tabular-nums">
        {t(filtered.length === 1 ? "flights.count.one" : "flights.count", {
          count: filtered.length,
        })}
      </p>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-3xl border border-slate-200/80 bg-white px-6 py-10 text-center shadow-2xs">
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
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {groups.map((group) => (
            <li key={group.cityKey} className="min-w-0">
              <CityFlightCard group={group} lang={locale} />
            </li>
          ))}
        </ul>
      )}

      <p className="text-center text-xs text-slate-400">
        {flightsUpdatedNote(data.date, data.isFallback)}
      </p>
    </div>
  );
}

function RegionTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`press-pill relative min-h-11 shrink-0 cursor-pointer pb-2 text-[15px] font-bold whitespace-nowrap transition-colors ${
        active ? "text-sprout-700" : "font-medium text-slate-500 hover:text-slate-900"
      }`}
    >
      {children}
      {active && (
        <SelectionPill
          layoutId="flights-region-underline"
          className="inset-x-0 bottom-0 h-[3px] rounded-full bg-sprout-500"
        />
      )}
    </button>
  );
}

function FilterSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-bold tracking-wide text-ink-muted">{label}</span>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
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
      className={`press-pill inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${
        active
          ? "border-sprout-500 bg-sprout-500 text-white shadow-2xs"
          : "border-slate-200 bg-slate-50/80 text-slate-700 hover:border-sprout-500/40 hover:bg-sprout-50"
      }`}
    >
      <span>{children}</span>
      {count !== undefined && (
        <span
          className={`text-[11px] tabular-nums ${
            active ? "text-white/85" : count === 0 ? "text-slate-300" : "text-slate-400"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}
