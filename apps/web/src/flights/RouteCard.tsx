import { routeEstimate, type FlightSearchIntent } from "@split/shared";
import { getLocale, t } from "../i18n/messages.js";
import { airportName } from "./AirportPicker.js";
import { friendlyRange } from "./dates.js";

const plane =
  "M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z";

/** The page headline: the destination's city, or the open question for a theme search. */
export function headline(intent: FlightSearchIntent): string {
  return intent.theme
    ? t("flight.headlineAsk")
    : t("flight.headline", { place: airportName(intent.destination) });
}

/** One end of the route: the code large, the city under it (the code alone when unknown). */
function Place({ code, end }: { code: string; end?: boolean }) {
  const name = airportName(code);
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 ${end ? "items-end text-right" : ""}`}>
      <span className="text-[40px] leading-none font-black tracking-[0.01em]">{code}</span>
      {name !== code && <span className="text-sm font-medium text-ink-muted">{name}</span>}
    </div>
  );
}

/** Distance and rough flight time, shown only when both airports have known coordinates. */
function leg(origin: string, destination: string): string | undefined {
  const estimate = routeEstimate(origin, destination);
  if (!estimate) return undefined;
  const hours = Math.floor(estimate.minutes / 60);
  return t("flight.routeLeg", {
    km: estimate.km.toLocaleString(getLocale()),
    hours,
    minutes: estimate.minutes - hours * 60,
  });
}

/**
 * The route hero card of the current search: large codes with city names, a plane line carrying
 * the distance and flight time, the dates and travellers, 修改 to open the editing panel and a
 * one-tap 重新探索航班. While the panel is open its own Search button takes over, so the card
 * shows only 修改.
 */
export function RouteCard({
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
  const estimate = leg(intent.origin, intent.destination);
  return (
    <section
      aria-label={t("flight.summaryCard")}
      className="mb-4 grid gap-3.5 rounded-[28px] border border-[#c4e4d3] bg-sprout-100 p-[18px]"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-sm font-medium text-sprout-700 [font-feature-settings:'palt']">
          {t("flight.summaryDates", {
            dates: friendlyRange(intent.departureDate, intent.returnDate),
          })}
        </p>
        <button
          type="button"
          disabled={pending}
          aria-expanded={open}
          onClick={onToggle}
          className="press-pill -my-1 flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border-[1.5px] border-sprout-900 bg-white px-3.5 text-sm font-bold focus-visible:outline-2 focus-visible:outline-sprout-700 disabled:opacity-60"
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="size-4 shrink-0 fill-none stroke-current stroke-[2.2] [stroke-linecap:round] [stroke-linejoin:round]"
          >
            <path d="M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4" />
          </svg>
          {t("flight.edit")}
        </button>
      </div>
      <div className="flex items-center justify-between gap-2">
        <Place code={intent.origin} />
        <div className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <div className="flex w-full items-center justify-center gap-1.5">
            <span className="h-0.5 flex-1 rounded-full bg-[#8cc3a8]" />
            <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6 shrink-0 fill-sprout-700">
              <path d={plane} />
            </svg>
            <span className="h-0.5 flex-1 rounded-full bg-[#8cc3a8]" />
          </div>
          {estimate && (
            <span className="text-center text-xs font-bold text-sprout-700 tabular-nums">
              {estimate}
            </span>
          )}
        </div>
        <Place code={intent.destination} end />
      </div>
      {!open && (
        <button
          type="button"
          disabled={pending}
          onClick={onSearch}
          className="press-pill flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-sprout-700 text-[17px] font-bold text-white focus-visible:outline-2 focus-visible:outline-sprout-900 disabled:opacity-60"
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="size-5 shrink-0 fill-none stroke-current stroke-[2.2] [stroke-linecap:round]"
          >
            <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
            <circle cx="16" cy="7" r="2" />
            <circle cx="8" cy="17" r="2" />
          </svg>
          {t("flight.exploreAgain")}
        </button>
      )}
    </section>
  );
}

/** The headline and its bell, which opens the Price Watch radar. */
export function TravelHeader({
  intent,
  onRadar,
}: {
  intent: FlightSearchIntent;
  onRadar: () => void;
}) {
  return (
    <header className="mb-5 flex items-start justify-between gap-3 px-1">
      <div className="grid min-w-0 gap-1">
        <h1 className="text-[32px] leading-[1.15] font-black">{headline(intent)}</h1>
        <p className="text-[15px] font-medium text-ink-muted">{t("flight.tagline")}</p>
      </div>
      <button
        type="button"
        aria-label={t("flight.radar")}
        onClick={onRadar}
        className="press-pill flex size-12 min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full border border-sprout-200 bg-white focus-visible:outline-2 focus-visible:outline-sprout-700"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="size-[22px] fill-none stroke-sprout-900 stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
        >
          <path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7M10 20a2 2 0 0 0 4 0" />
        </svg>
      </button>
    </header>
  );
}
