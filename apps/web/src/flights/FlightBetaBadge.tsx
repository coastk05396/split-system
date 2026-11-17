import { t } from "../i18n/messages.js";

/** Amber BETA pill beside the Flights title. */
export function FlightBetaBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full bg-[#fef3c7] px-2 py-0.5 text-[10px] leading-[14px] font-bold tracking-[0.06em] text-[#92400e] select-none ${className}`}
    >
      {t("flights.betaBadge")}
    </span>
  );
}
