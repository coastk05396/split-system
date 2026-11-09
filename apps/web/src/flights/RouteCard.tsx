import { Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { partyOf, routeEstimate, type FlightSearchIntent } from "@split/shared";
import { getLocale, t } from "../i18n/messages.js";
import { airportName } from "./AirportPicker.js";
import { friendlyRange, shortRange } from "./dates.js";
import type { FareSort } from "./FareResults.js";
import { Globe } from "./Globe.js";
import { prefersReducedMotion } from "../shell/motion.js";

/** The page headline: the destination's city, or the open question for a theme search. */
export function headline(intent: FlightSearchIntent): string {
  return intent.theme
    ? t("flight.headlineAsk")
    : t("flight.headline", { place: airportName(intent.destination) });
}

/** A number that rolls to its new value (ease-out, 800 ms) instead of jumping; reduced motion jumps. */
function useRoll(target: number | undefined): number | undefined {
  const [shown, setShown] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    if (target === undefined || prefersReducedMotion()) return;
    if (current.current === undefined) {
      current.current = target;
      setShown(target);
      return;
    }
    const start = current.current;
    if (start === target) return;
    const t0 = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 800);
      current.current =
        k >= 1 ? target : Math.round(start + (target - start) * (1 - 2 ** (-10 * k)));
      setShown(current.current);
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [target]);
  return prefersReducedMotion() ? target : shown;
}

/**
 * Distance and rough flight time beside the globe, rolling to each new route; shown only when both
 * airports have known coordinates. The rolling figures are hidden from assistive tech, which gets
 * the settled text once.
 */
function Leg({ origin, destination }: { origin: string; destination: string }) {
  const estimate = routeEstimate(origin, destination);
  const km = useRoll(estimate?.km);
  const minutes = useRoll(estimate?.minutes);
  if (!estimate || km === undefined || minutes === undefined) return null;
  const hours = Math.floor(estimate.minutes / 60);
  return (
    <p className="fr-leg">
      <span className="sr-only">
        {t("flight.routeLeg", {
          km: estimate.km.toLocaleString(getLocale()),
          hours,
          minutes: estimate.minutes - hours * 60,
        })}
      </span>
      <span aria-hidden="true">
        {t("flight.legDistance")} <b data-leg="km">{km.toLocaleString(getLocale())}</b>{" "}
        {t("flight.legKm")}
      </span>
      <span aria-hidden="true">
        {t("flight.legTime")}{" "}
        <b data-leg="time">
          {t("flight.legDuration", {
            hours: Math.floor(minutes / 60),
            minutes: String(minutes % 60).padStart(2, "0"),
          })}
        </b>
      </span>
    </p>
  );
}

/**
 * The route hero card of the current search: large codes with city names, a plane line carrying
 * the distance and flight time, the Route Chip (route and dates, a pencil, opens the editing panel) and
 * a one-tap 重新探索航班. While the panel is open its own Search button takes over, so the card
 * shows only the chip.
 */
export function RouteCard({
  intent,
  pending,
  open,
  onToggle,
  sort,
  onSort,
}: {
  intent: FlightSearchIntent;
  pending: boolean;
  open: boolean;
  onToggle: () => void;
  sort: FareSort;
  onSort: (key: FareSort["key"]) => void;
}) {
  const fullDates = friendlyRange(intent.departureDate, intent.returnDate);
  const party = partyOf(intent);
  const partyNote = [
    party.oneWay && t("flight.chipOneWay"),
    party.people + party.infants > 1 && t("flight.chipPeople", { n: party.people + party.infants }),
  ]
    .filter(Boolean)
    .map((x) => ` · ${String(x)}`)
    .join("");
  return (
    <section aria-label={t("flight.summaryCard")} className="contents">
      <div className="fr-chips @container">
        <button
          type="button"
          disabled={pending}
          aria-label={
            t("flight.routeChip", {
              route: `${airportName(intent.origin)} → ${airportName(intent.destination)}`,
              dates: fullDates,
            }) + partyNote
          }
          aria-expanded={open}
          onClick={onToggle}
          className="fr-chip fr-hit"
        >
          {/* Wide card: city names (only these may shrink) then the dates. */}
          <span className="hidden min-w-0 items-center gap-1.5 @lg:flex">
            <span className="min-w-0 truncate">
              {airportName(intent.origin)} → {airportName(intent.destination)}
            </span>
            <span className="shrink-0">{fullDates + partyNote}</span>
          </span>
          {/* Narrow card: city names (only these may shrink) and short dates, so the dates cannot be clipped. */}
          <span className="flex min-w-0 items-center gap-1.5 @lg:hidden">
            <span className="min-w-0 truncate">
              {airportName(intent.origin)} → {airportName(intent.destination)}
            </span>
            <span className="shrink-0">
              {shortRange(intent.departureDate, intent.returnDate) + partyNote}
            </span>
          </span>
          <svg viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
            <path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" />
          </svg>
        </button>
        <div role="group" aria-label={t("flight.sort")} className="fr-sbar">
          {(["price", "time"] as const).map((key) => {
            const active = sort.key === key;
            const label = key === "price" ? "Price" : "Time";
            const state = active && sort.descending ? "Desc" : "Asc";
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                aria-label={t(`flight.sort${label}${state}`)}
                onClick={() => {
                  onSort(key);
                }}
                className="fr-sb fr-hit"
              >
                <span>{t(`flight.sort${label}`)}</span>
                <i aria-hidden="true">{sort.descending && active ? "↓" : "↑"}</i>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** The small gear that stands in for 設定, which Travel mode's nav does not carry. */
export function SettingsLink({ className }: { className?: string } = {}) {
  return (
    <Link
      to="/settings"
      aria-label={t("nav.settings")}
      className={
        className ??
        "press-pill flex size-11 min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full border border-sprout-200 bg-white focus-visible:outline-2 focus-visible:outline-sprout-700"
      }
    >
      <Settings aria-hidden="true" className="size-[22px] stroke-sprout-900" strokeWidth={2} />
    </Link>
  );
}

/**
 * The headline and its bell, which links to the Price Watch list. With `globe` (Flight Radar) the
 * Route Globe sits at the top right, about 118 px, with the rolling distance and flight time under
 * the tagline and the buttons under those; without it (Explore) the buttons sit at the right.
 */
export function TravelHeader({
  intent,
  globe,
}: {
  intent: FlightSearchIntent;
  /** The catalogue airport the globe faces; omit the prop for no globe. */
  globe?: { code: string | undefined };
}) {
  const buttons = globe ? null : (
    <div className="flex shrink-0 gap-1.5">
      <Link
        to="/travel/watches"
        aria-label={t("flight.radar")}
        className="press-pill flex size-11 min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full border border-sprout-200 bg-white focus-visible:outline-2 focus-visible:outline-sprout-700"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="size-[22px] fill-none stroke-sprout-900 stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
        >
          <path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7M10 20a2 2 0 0 0 4 0" />
        </svg>
      </Link>
      <SettingsLink />
    </div>
  );
  const title = (
    <>
      <h1 className={globe ? undefined : "text-[28px] leading-[1.15] font-black"}>
        {headline(intent)}
      </h1>
      {!globe && <p className="text-[15px] font-medium text-ink-muted">{t("flight.tagline")}</p>}
    </>
  );
  if (!globe)
    return (
      <header className="mb-5 flex items-start justify-between gap-3 px-1">
        <div className="grid min-w-0 gap-1">{title}</div>
        {buttons}
      </header>
    );
  return (
    <header className="fr-head">
      <div className="fr-hl grid justify-items-start">
        {title}
        <Leg origin={intent.origin} destination={intent.destination} />
      </div>
      {/* The bob and the negative margins are the reference mock's: the globe floats at the corner. */}
      <div className="fr-mini globe-bob">
        <Globe code={globe.code} from={intent.origin} size={118} />
      </div>
    </header>
  );
}
