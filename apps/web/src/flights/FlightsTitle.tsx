import { t } from "../i18n/messages.js";
import { CuteTripPlaneIcon } from "../pages/HomeIcons.js";
import { FlightBetaBadge } from "./FlightBetaBadge.js";

/**
 * The flights board title, shared by /flights (signed in and out) and the landing page: a serif
 * one-line title with a thin-outline BETA label beside it, then a muted refresh note.
 */
export function FlightsTitle({
  as: Heading = "h1",
  size = "lg",
}: {
  as?: "h1" | "h2";
  size?: "lg" | "md";
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <Heading
          className={`font-serif-tc font-bold whitespace-nowrap text-fl-ink ${size === "lg" ? "text-[28px] leading-9" : "text-[22px] leading-[30px]"}`}
        >
          {t("flights.title")}
        </Heading>
        <FlightBetaBadge />
      </div>
      <p className="mt-0.5 truncate text-[13px] leading-[18px] text-fl-muted">
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
