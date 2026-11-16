import { t } from "../i18n/messages.js";

/**
 * Low-saturation Beta status pill used on Flights entry points and headers
 * without competing against emerald discount signals.
 */
export function FlightBetaBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full bg-amber-100 px-2 py-1 text-[10px] leading-none font-bold tracking-wider text-amber-800 uppercase select-none ${className}`}
    >
      {t("flights.betaBadge")}
    </span>
  );
}
