import type { CurrencyCode } from "@split/shared";
import { useId, useState } from "react";
import { getLocale, t } from "../i18n/messages.js";
import { addDays, friendlyDate } from "./dates.js";
import { usePriceStrip } from "./PriceStrip.js";

const WEEKDAYS = {
  en: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"],
  "zh-TW": ["日", "一", "二", "三", "四", "五", "六"],
} as const;
/** Fewer saved days than this say nothing about which are cheap, so no dot is drawn. */
const MIN_PRICED_DAYS = 3;
/** The return date a first tap offers, so an abandoned pick is still a valid trip. */
const DEFAULT_STAY = 3;

const monthLabel = (month: string) => {
  const [year = 0, mo = 1] = month.split("-").map(Number);
  return getLocale() === "en"
    ? new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(
        new Date(Date.UTC(year, mo - 1, 1)),
      )
    : `${String(year)} 年 ${String(mo)} 月`;
};
const shiftMonth = (month: string, by: number) => {
  const [year = 0, mo = 1] = month.split("-").map(Number);
  return new Date(Date.UTC(year, mo - 1 + by, 1)).toISOString().slice(0, 7);
};

/**
 * Cheap days of one month from its saved Fare Snapshots: the cheapest three-tenths, the same rule
 * as the Price Strip's "cheap" bars. Empty when too few days are saved.
 */
function cheapDays(days: { date: string; price: number }[]): Set<string> {
  if (days.length < MIN_PRICED_DAYS) return new Set();
  const sorted = days.map((d) => d.price).sort((a, b) => a - b);
  const cut = sorted[Math.floor(sorted.length * 0.3)] ?? 0;
  return new Set(days.filter((d) => d.price <= cut).map((d) => d.date));
}

function Month({
  month,
  route,
  today,
  departure,
  returnDate,
  onPick,
}: {
  month: string;
  route: { origin: string; destination: string; currency: CurrencyCode };
  today: string;
  departure: string;
  /** The picked return date, or undefined while it is being chosen or for a one-way trip. */
  returnDate: string | undefined;
  onPick: (date: string) => void;
}) {
  const { pending, days } = usePriceStrip(route.origin, route.destination, route.currency, [month]);
  const cheap = pending
    ? new Set<string>()
    : cheapDays(days.filter((d) => d.date.startsWith(month)));
  const [year = 0, mo = 1] = month.split("-").map(Number);
  const lead = new Date(Date.UTC(year, mo - 1, 1)).getUTCDay();
  const count = new Date(Date.UTC(year, mo, 0)).getUTCDate();
  const names = WEEKDAYS[getLocale() === "en" ? "en" : "zh-TW"];
  return (
    <>
      <div
        className="grid grid-cols-7 text-center text-xs font-semibold text-ink-muted"
        aria-hidden="true"
      >
        {names.map((name) => (
          <span key={name} className="py-1">
            {name}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead-${String(i)}`} />
        ))}
        {Array.from({ length: count }, (_, i) => {
          const date = `${month}-${String(i + 1).padStart(2, "0")}`;
          const edge = date === departure || date === returnDate;
          const inRange = returnDate !== undefined && date > departure && date < returnDate;
          const isCheap = cheap.has(date);
          const past = date < today;
          return (
            <button
              key={date}
              type="button"
              disabled={past}
              aria-pressed={edge}
              aria-label={friendlyDate(date) + (isCheap ? `, ${t("flight.calCheapDay")}` : "")}
              data-in-range={inRange ? "true" : undefined}
              onClick={() => {
                onPick(date);
              }}
              className={`press-pill relative grid min-h-11 place-items-center text-sm font-semibold tabular-nums focus-visible:outline-2 focus-visible:outline-sprout-700 ${
                past
                  ? "cursor-not-allowed text-travel-disabled-ink line-through"
                  : edge
                    ? "rounded-xl bg-travel-action font-bold text-white hover:bg-travel-action-hover"
                    : inRange
                      ? "bg-sprout-100 text-sprout-900"
                      : "rounded-xl text-sprout-900 hover:bg-sprout-100"
              } ${isCheap ? `after:absolute after:bottom-1 after:size-1.5 after:rounded-full after:content-[''] ${edge ? "after:bg-white" : "after:bg-sprout-700"}` : ""}`}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
      {cheap.size > 0 && (
        <p className="mt-2 flex items-center gap-1.5 px-2 text-xs text-ink-muted">
          <i aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-sprout-700" />
          {t("flight.calNote")}
        </p>
      )}
    </>
  );
}

/**
 * A toggle that opens a month calendar under the date fields: green dots mark the days whose saved
 * Fare Snapshot is cheap, a round trip takes a range (departure tap, then return tap) and a one-way
 * trip a single day. The native date fields stay as the typed and screen-reader route.
 */
export function DatesCalendar({
  route,
  today,
  departure,
  returnDate,
  oneWay,
  onChange,
}: {
  route: { origin: string; destination: string; currency: CurrencyCode };
  today: string;
  departure: string;
  returnDate: string;
  oneWay: boolean;
  onChange: (patch: { departureDate?: string; returnDate?: string }) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(departure.slice(0, 7));
  /** True between the departure tap and the return tap. */
  const [choosingReturn, setChoosingReturn] = useState(false);
  const toggle = () => {
    setOpen((o) => !o);
    setChoosingReturn(false);
    setMonth(departure.slice(0, 7));
  };
  function pick(date: string) {
    if (oneWay) {
      onChange({ departureDate: date });
      toggle();
    } else if (!choosingReturn || date <= departure) {
      onChange({ departureDate: date, returnDate: addDays(date, DEFAULT_STAY) });
      setChoosingReturn(true);
    } else {
      onChange({ returnDate: date });
      toggle();
    }
  }
  return (
    <div className="grid gap-2 sm:col-span-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={toggle}
        className="press-pill flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl border border-sprout-200 bg-white px-4 text-left text-sm font-bold text-sprout-900 hover:bg-sprout-100 focus-visible:outline-2 focus-visible:outline-sprout-700"
      >
        {open ? t("flight.calClose") : t("flight.calOpen")}
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="size-5 shrink-0 fill-none stroke-sprout-900 stroke-[2.2] [stroke-linecap:round] [stroke-linejoin:round]"
        >
          <path d={open ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
        </svg>
      </button>
      {open && (
        <div
          id={id}
          role="group"
          aria-label={t("flight.calendar")}
          // Bleeds into the form padding so seven 44 px days fit a 360 px phone.
          className="cal-pop -mx-4 grid gap-1 rounded-2xl bg-sprout-50 py-2 text-sprout-900"
        >
          <div className="flex items-center justify-between px-2 font-bold">
            <button
              type="button"
              aria-label={t("flight.calPrev")}
              disabled={month <= today.slice(0, 7)}
              onClick={() => {
                setMonth((m) => shiftMonth(m, -1));
              }}
              className="press-pill grid size-11 place-items-center rounded-full border border-sprout-200 bg-white text-lg focus-visible:outline-2 focus-visible:outline-sprout-700 disabled:border-travel-disabled disabled:bg-travel-disabled disabled:text-travel-disabled-ink"
            >
              <span aria-hidden="true">‹</span>
            </button>
            <span aria-live="polite">{monthLabel(month)}</span>
            <button
              type="button"
              aria-label={t("flight.calNext")}
              onClick={() => {
                setMonth((m) => shiftMonth(m, 1));
              }}
              className="press-pill grid size-11 place-items-center rounded-full border border-sprout-200 bg-white text-lg focus-visible:outline-2 focus-visible:outline-sprout-700"
            >
              <span aria-hidden="true">›</span>
            </button>
          </div>
          <Month
            month={month}
            route={route}
            today={today}
            departure={departure}
            returnDate={oneWay || choosingReturn ? undefined : returnDate}
            onPick={pick}
          />
          {choosingReturn && (
            <p role="status" className="px-2 text-xs font-bold text-ink-muted">
              {t("flight.calReturn")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
