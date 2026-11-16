import { t } from "../i18n/messages.js";

/**
 * Low-saturation Beta status pill used on Flights entry points and headers
 * without competing against emerald discount signals.
 */
export function FlightBetaBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border border-amber-200/90 bg-amber-50 px-1.5 py-0.5 text-[10px] leading-none font-bold tracking-wider text-amber-700 uppercase select-none ${className}`}
    >
      {t("flights.betaBadge")}
    </span>
  );
}
