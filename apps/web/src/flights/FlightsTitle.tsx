import { getLocale, t } from "../i18n/messages.js";
import { CuteTripPlaneIcon } from "../pages/HomeIcons.js";
import { FlightBetaBadge } from "./FlightBetaBadge.js";

/**
 * The flights board title, shared by /flights (signed in and out) and the landing page: a big
 * one-line title with a small BETA pill beside it, then a soft grey refresh note.
 * `compact` shrinks the English title for the crowded public header at 390px.
 */
export function FlightsTitle({
  as: Heading = "h1",
  compact = false,
}: {
  as?: "h1" | "h2";
  compact?: boolean;
}) {
  const size = compact && getLocale() === "en" ? "text-base" : "text-[22px]";
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1.5">
        <Heading
          className={`leading-tight font-black tracking-tight whitespace-nowrap text-slate-900 sm:text-2xl ${size}`}
        >
          {t("flights.title")}
        </Heading>
        <FlightBetaBadge />
      </div>
      <p className="mt-0.5 truncate text-[13px] leading-tight text-slate-500">
        {t("flights.subtitle")}
      </p>
    </div>
  );
}

/** Flights icon tile (~44px) that sits vertically centred against the two-line title block. */
export function FlightsIconTile() {
  return (
    <span className="flight-badge-enter flex size-11 shrink-0 items-center justify-center rounded-2xl bg-sprout-100 shadow-2xs">
      <CuteTripPlaneIcon aria-hidden="true" className="size-8" />
    </span>
  );
}
