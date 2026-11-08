import {
  formatAmount,
  type CurrencyCode,
  type FlightCard,
  type FlightSearchReply,
} from "@split/shared";
import { useEffect, useId, useRef } from "react";
import { t } from "../i18n/messages.js";
import { friendlyDate, shortDate } from "./dates.js";

export interface TileDay {
  date: string;
  /** The date's cheapest fare. */
  price: number;
  /** No other shown date is cheaper (a tie marks every cheapest date). */
  lowest: boolean;
}
export interface DateTilesModel {
  days: TileDay[];
  currency: CurrencyCode;
  /** The date the User searched, when it was priced: what differences are measured against. */
  start: TileDay | undefined;
  selected: string;
}

/**
 * The Date Tiles of a search: one tile per departure date its returned fares actually priced.
 * Theme searches span destinations and a single date has nothing to compare, so neither has any.
 * `picked` is the date the User chose on this reply; otherwise it opens on the searched date.
 */
export function dateTiles(
  reply: FlightSearchReply | undefined,
  picked: string | undefined,
): DateTilesModel | null {
  if (!reply || reply.intent.theme !== undefined) return null;
  const cheapest = new Map<string, number>();
  for (const card of reply.cards) {
    const date = card.intent.departureDate;
    cheapest.set(date, Math.min(card.price, cheapest.get(date) ?? Infinity));
  }
  if (cheapest.size < 2) return null;
  const prices = [...cheapest.values()];
  const low = Math.min(...prices);
  const days = [...cheapest]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, price]) => ({ date, price, lowest: price === low }));
  const start = days.find((day) => day.date === reply.intent.departureDate);
  const cheapestDay = days.reduce((best, day) => (day.price < best.price ? day : best));
  const selected = days.find((day) => day.date === picked)?.date ?? (start ?? cheapestDay).date;
  return { days, currency: reply.intent.currency, start, selected };
}

export function cardsOnDate(cards: FlightCard[], date: string | undefined): FlightCard[] {
  return date === undefined ? cards : cards.filter((card) => card.intent.departureDate === date);
}

/** The amount in full without its currency symbol, which would not fit a narrow tile. */
const plainAmount = (price: number, currency: CurrencyCode) =>
  formatAmount(price, currency).replace(/^\S+\s/, "");

/**
 * A row of tiles, five to the width and more scrolling sideways inside the row. Each is a
 * pressable button for one date: the cheapest is amber and 最低, the selected is outlined and 已選.
 * A persistent line, in a live region, compares the selected date with the searched one.
 */
export function DateTiles({
  tiles,
  onSelect,
}: {
  tiles: DateTilesModel;
  onSelect: (date: string) => void;
}) {
  const { days, currency, start, selected } = tiles;
  const heading = useId();
  const row = useRef<HTMLDivElement>(null);
  const current = days.find((day) => day.date === selected);
  // Keep the selected tile in view when the row scrolls; it never moves the page itself.
  useEffect(() => {
    const element = row.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (row.current && element)
      row.current.scrollLeft =
        element.offsetLeft - (row.current.clientWidth - element.offsetWidth) / 2;
  }, [selected]);

  const difference = start && current ? current.price - start.price : 0;
  const note = !start
    ? ""
    : difference === 0
      ? t("flight.tileSame")
      : t(difference < 0 ? "flight.tileCheaper" : "flight.tilePricier", {
          date: shortDate(start.date),
          amount: formatAmount(Math.abs(difference), currency),
        });

  return (
    <section aria-labelledby={heading} className="mt-6 grid gap-2.5">
      <div className="grid gap-0.5 px-1">
        <h2 id={heading} className="text-[22px] font-black">
          {t("flight.tilesTitle")}
        </h2>
        <p className="text-sm font-medium text-ink-muted">{t("flight.tilesHint")}</p>
      </div>
      <div ref={row} className="flex gap-2 overflow-x-auto pb-1">
        {days.map((day) => {
          const isSelected = day.date === selected;
          const labels = [
            ...(isSelected ? [t("flight.tileSelected")] : []),
            ...(day.lowest ? [t("flight.tileLowest")] : []),
          ];
          return (
            <button
              key={day.date}
              type="button"
              aria-pressed={isSelected}
              aria-label={[
                `${friendlyDate(day.date)} · ${formatAmount(day.price, currency)}`,
                ...labels,
              ].join(" · ")}
              data-lowest={day.lowest ? "true" : undefined}
              onClick={() => {
                onSelect(day.date);
              }}
              className={`press-pill flex h-[104px] min-w-[calc((100%-2rem)/5)] flex-1 basis-0 flex-col items-center justify-center gap-0.5 rounded-[18px] px-0.5 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-sprout-700 ${
                isSelected
                  ? `border-[3px] border-sprout-700 ${day.lowest ? "bg-[#fdf0d5] text-[#6b3f00]" : "bg-sprout-100 text-sprout-900"}`
                  : day.lowest
                    ? "border-[1.5px] border-[#f0c978] bg-[#fdf0d5] text-[#6b3f00]"
                    : "border-[1.5px] border-sprout-200 bg-white text-sprout-900"
              }`}
            >
              <span aria-hidden="true" className="text-[13px] font-medium">
                {shortDate(day.date)}
              </span>
              <span
                aria-hidden="true"
                className="text-[clamp(14px,4.4vw,17px)] font-black tabular-nums"
              >
                {plainAmount(day.price, currency)}
              </span>
              <span aria-hidden="true" className="grid min-h-4 text-xs leading-4 font-black">
                {labels.map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </span>
            </button>
          );
        })}
      </div>
      {/* Mounted from the first render so a screen reader announces even the first change. */}
      <p role="status" className="min-h-6 px-1 text-[15px] font-bold text-sprout-700">
        {note}
      </p>
    </section>
  );
}
