import type { CurrencyCode } from "@split/shared";
import { useId, useState } from "react";
import { getLocale, t } from "../i18n/messages.js";
import { addDays, friendlyDate, friendlyRange } from "./dates.js";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
import { usePriceStrip } from "./PriceStrip.js";

const WEEKDAYS = {
  en: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"],
  "zh-TW": ["日", "一", "二", "三", "四", "五", "六"],
} as const;
/** Fewer saved days than this say nothing about which are cheap, so no dot is drawn. */
const MIN_PRICED_DAYS = 3;
/** The return date a first tap offers, so an abandoned pick is still a valid trip. */
const DEFAULT_STAY = 3;

/** The month a calendar opens on: the departure's, or today's while that field is empty or invalid. */
const openMonth = (departure: string, today: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(departure) ? departure.slice(0, 7) : today.slice(0, 7);

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
      <div className="fr-cal-g">
        {names.map((name) => (
          <span key={name} className="w" aria-hidden="true">
            {name}
          </span>
        ))}
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
              data-cheap={isCheap ? "true" : undefined}
              onClick={() => {
                onPick(date);
              }}
              className="fr-d"
            >
              {i + 1}
            </button>
          );
        })}
      </div>
      {cheap.size > 0 && (
        <p className="fr-cal-n">
          <i aria-hidden="true" />
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
  const [month, setMonth] = useState(openMonth(departure, today));
  /** True between the departure tap and the return tap. */
  const [choosingReturn, setChoosingReturn] = useState(false);
  const toggle = () => {
    setOpen((o) => !o);
    setChoosingReturn(false);
    setMonth(openMonth(departure, today));
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
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={toggle}
        className="fr-date fr-hit"
      >
        <span aria-hidden="true">
          <span className="fr-lb">{t("flight.dates")}</span>
          <b>
            {ISO.test(departure)
              ? oneWay || !ISO.test(returnDate)
                ? friendlyDate(departure)
                : friendlyRange(departure, returnDate)
              : ""}
          </b>
        </span>
        <em>{open ? t("flight.calClose") : t("flight.calOpen")}</em>
      </button>
      {open && (
        <div id={id} role="group" aria-label={t("flight.calendar")} className="fr-cal-in cal-pop">
          <div className="fr-cal-h">
            <button
              type="button"
              aria-label={t("flight.calPrev")}
              disabled={month <= today.slice(0, 7)}
              onClick={() => {
                setMonth((m) => shiftMonth(m, -1));
              }}
              className="fr-hit"
            >
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                className="fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
              >
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </button>
            <span aria-live="polite">{monthLabel(month)}</span>
            <button
              type="button"
              aria-label={t("flight.calNext")}
              onClick={() => {
                setMonth((m) => shiftMonth(m, 1));
              }}
              className="fr-hit"
            >
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                className="fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
              >
                <path d="M9 6l6 6-6 6" />
              </svg>
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
            <p role="status" className="fr-cal-n font-bold">
              {t("flight.calReturn")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
