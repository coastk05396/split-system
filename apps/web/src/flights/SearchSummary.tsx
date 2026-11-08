import type { FlightSearchIntent } from "@split/shared";
import { t } from "../i18n/messages.js";
import { airportName } from "./AirportPicker.js";
import { friendlyRange } from "./dates.js";

const icon =
  "size-4 shrink-0 fill-none stroke-current stroke-[2.2] [stroke-linecap:round] [stroke-linejoin:round]";

/** One end of the route: the city large with its code small, or the bare code when unknown. */
function Place({ code }: { code: string }) {
  const name = airportName(code);
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-[22px] font-black leading-tight">{name}</span>
      {name !== code && <span className="text-xs font-bold text-ink-muted">{code}</span>}
    </span>
  );
}

/**
 * The summary of the current search: route, dates and travellers, with 修改 to edit them and a
 * one-tap 搜尋航班. While the editing panel is open its own Search button takes over, so the
 * card shows only 修改.
 */
export function SearchSummary({
  intent,
  pending,
  open,
  onToggle,
  onSearch,
}: {
  intent: FlightSearchIntent;
  pending: boolean;
  open: boolean;
  onToggle: () => void;
  onSearch: () => void;
}) {
  return (
    <section
      aria-label={t("flight.summaryCard")}
      className="surface-card mb-3 grid gap-3 rounded-3xl border border-sprout-200 bg-white p-4"
    >
      <div className="flex items-start gap-3">
        <p className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <Place code={intent.origin} />
          <svg viewBox="0 0 24 24" aria-hidden="true" className={`${icon} size-[18px] self-center`}>
            <path d="M4 12h16M14 6l6 6-6 6" />
          </svg>
          <Place code={intent.destination} />
        </p>
        <button
          type="button"
          disabled={pending}
          aria-expanded={open}
          onClick={onToggle}
          className="press-pill flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border-[1.5px] border-sprout-900 bg-white px-3.5 text-sm font-bold focus-visible:outline-2 focus-visible:outline-sprout-700 disabled:opacity-60"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className={icon}>
            <path d="M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4" />
          </svg>
          {t("flight.edit")}
        </button>
      </div>
      <p className="-mt-1 text-sm text-ink-muted [font-feature-settings:'palt']">
        {t("flight.summaryDates", {
          dates: friendlyRange(intent.departureDate, intent.returnDate),
        })}
      </p>
      {!open && (
        <button
          type="button"
          disabled={pending}
          onClick={onSearch}
          className="press-pill flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-sprout-700 text-[17px] font-bold text-white focus-visible:outline-2 focus-visible:outline-sprout-900 disabled:opacity-60"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className={`${icon} size-[18px]`}>
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
          {t("flight.search")}
        </button>
      )}
    </section>
  );
}
