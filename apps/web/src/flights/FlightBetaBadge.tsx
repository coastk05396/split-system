import { t } from "../i18n/messages.js";

/** Thin-outline BETA label beside the Flights title: quiet, no fill or icon. */
export function FlightBetaBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-sm border border-[#bbd6c6] px-[5px] py-px text-[10px] leading-[14px] font-semibold tracking-[0.08em] text-fl-green uppercase select-none ${className}`}
    >
      {t("flights.betaBadge")}
    </span>
  );
}
