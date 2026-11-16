import { getLocale, t } from "../i18n/messages.js";
import { CuteTripPlaneIcon } from "../pages/HomeIcons.js";
import { FlightBetaBadge } from "./FlightBetaBadge.js";

/**
 * The flights board title, shared by /flights (signed in and out) and the landing page: a big
 * one-line title, then a grey refresh note. BETA sits beside the title in zh-TW; in English it
 * moves to the note line so the title never wraps. `compact` is for the crowded public header.
 */
export function FlightsTitle({
  as: Heading = "h1",
  compact = false,
}: {
  as?: "h1" | "h2";
  compact?: boolean;
}) {
  const betaBelow = getLocale() === "en";
  const size = betaBelow ? (compact ? "text-[15px]" : "text-xl") : "text-[22px]";
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1.5">
        <Heading
          className={`leading-tight font-black tracking-tight whitespace-nowrap text-slate-900 sm:text-2xl ${size}`}
        >
          {t("flights.title")}
        </Heading>
        {!betaBelow && <FlightBetaBadge />}
      </div>
      <p
        className={`mt-0.5 flex items-center gap-1.5 leading-tight text-slate-500 ${betaBelow && compact ? "text-[11px]" : "text-[13px]"}`}
      >
        {betaBelow && <FlightBetaBadge />}
        <span className="truncate">{t("flights.subtitle")}</span>
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
