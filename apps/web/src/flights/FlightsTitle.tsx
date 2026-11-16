import { getLocale, t } from "../i18n/messages.js";
import { CuteTripPlaneIcon } from "../pages/HomeIcons.js";
import { FlightBetaBadge } from "./FlightBetaBadge.js";

/** `● 每天 08:00 更新`: the refresh note under the title. */
export function FlightsUpdateNote({ className = "" }: { className?: string }) {
  return (
    <p
      className={`flex min-w-0 items-center gap-[7px] text-[13px] leading-[18px] whitespace-nowrap text-fl-muted ${className}`}
    >
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full bg-[#5fb394] ring-[3px] ring-[#e0f2ea]"
      />
      <span className="truncate">{t("flights.subtitle")}</span>
    </p>
  );
}

/**
 * The flights board title, shared by /flights (signed in and out) and the landing page: a bold
 * one-line title with its key words marked in mint and an amber BETA pill beside it; `note` adds
 * the refresh note below.
 */
export function FlightsTitle({
  as: Heading = "h1",
  size = "lg",
  note = false,
}: {
  as?: "h1" | "h2";
  size?: "lg" | "md";
  note?: boolean;
}) {
  const title = t("flights.title");
  const mark = t("flights.titleHighlight");
  const at = title.indexOf(mark);
  // English is wider than 中文 beside BETA on a phone: smaller, and only 中文 stays nowrap.
  const en = getLocale() === "en";
  const wrap = en ? "text-balance" : "whitespace-nowrap";
  const text =
    size === "md"
      ? "text-[22px] leading-[30px]"
      : en
        ? "text-[22px] leading-7"
        : "text-[26px] leading-8";
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <Heading className={`font-black text-fl-ink ${wrap} ${text}`}>
          {at < 0 ? (
            title
          ) : (
            <>
              {title.slice(0, at)}
              <span className="bg-[linear-gradient(transparent_60%,#d3ebdf_60%)] px-0.5">
                {mark}
              </span>
              {title.slice(at + mark.length)}
            </>
          )}
        </Heading>
        <FlightBetaBadge />
      </div>
      {note && <FlightsUpdateNote className="mt-2.5" />}
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
