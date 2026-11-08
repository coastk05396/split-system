import {
  formatAmount,
  type CurrencyCode,
  type FlightCard,
  type FlightSearchReply,
} from "@split/shared";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { t } from "../i18n/messages.js";
import { prefersReducedMotion } from "../shell/motion.js";
import { friendlyDate, shortDate } from "./dates.js";

type Tone = "cheap" | "normal" | "pricey";
export interface StripDay {
  date: string;
  /** The date's cheapest fare. */
  price: number;
  tone: Tone;
  /** No other shown date is cheaper (a tie marks every cheapest date). */
  lowest: boolean;
}
export interface PriceStripModel {
  days: StripDay[];
  currency: CurrencyCode;
  /** The date the User searched, when it was priced: what differences are measured against. */
  start: StripDay | undefined;
  selected: string;
}

/**
 * The Price Strip of a search: one bar per departure date its returned fares actually priced.
 * Theme searches span destinations and a single date has nothing to compare, so neither has one.
 * `picked` is the date the User chose on this reply; otherwise it opens on the searched date.
 */
export function priceStrip(
  reply: FlightSearchReply | undefined,
  picked: string | undefined,
): PriceStripModel | null {
  if (!reply || reply.intent.theme !== undefined) return null;
  const cheapest = new Map<string, number>();
  for (const card of reply.cards) {
    const date = card.intent.departureDate;
    cheapest.set(date, Math.min(card.price, cheapest.get(date) ?? Infinity));
  }
  if (cheapest.size < 2) return null;
  const prices = [...cheapest.values()];
  const low = Math.min(...prices);
  const spread = Math.max(...prices) - low;
  const tone = (price: number): Tone => {
    const position = spread === 0 ? 0.5 : (price - low) / spread;
    return position < 1 / 3 ? "cheap" : position > 2 / 3 ? "pricey" : "normal";
  };
  const days = [...cheapest]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, price]) => ({ date, price, tone: tone(price), lowest: price === low }));
  const start = days.find((day) => day.date === reply.intent.departureDate);
  const cheapestDay = days.reduce((best, day) => (day.price < best.price ? day : best));
  const selected = days.find((day) => day.date === picked)?.date ?? (start ?? cheapestDay).date;
  return { days, currency: reply.intent.currency, start, selected };
}

export function cardsOnDate(cards: FlightCard[], date: string | undefined): FlightCard[] {
  return date === undefined ? cards : cards.filter((card) => card.intent.departureDate === date);
}

const toneLabel = (tone: Tone) =>
  t(
    tone === "cheap"
      ? "flight.stripCheap"
      : tone === "pricey"
        ? "flight.stripPricey"
        : "flight.stripNormal",
  );

/** How long the "cheaper or dearer than where you started" note stays. */
const NOTE_MS = 2200;

/**
 * Bars for the priced dates. Tap, drag or arrow keys pick the date whose fares the carousel
 * shows. A legend and a ghost finger teach the gesture until the first touch.
 */
export function PriceStrip({
  strip,
  touched,
  onTouch,
  onSelect,
}: {
  strip: PriceStripModel;
  touched: boolean;
  onTouch: () => void;
  onSelect: (date: string) => void;
}) {
  const { days, currency, start, selected } = strip;
  const motion = !prefersReducedMotion();
  const index = days.findIndex((day) => day.date === selected);
  const current = days[index];
  const dragging = useRef(false);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  useEffect(() => {
    if (noteFor === null) return;
    const timer = setTimeout(() => {
      setNoteFor(null);
    }, NOTE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [noteFor]);

  function pick(next: number) {
    const day = days[Math.min(days.length - 1, Math.max(0, next))];
    onTouch();
    if (!day || day.date === selected) return;
    setNoteFor(day.date);
    onSelect(day.date);
  }
  const pickAt = (event: PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width > 0) pick(Math.floor(((event.clientX - box.left) / box.width) * days.length));
  };
  function onKeyDown(event: KeyboardEvent) {
    const target = {
      ArrowLeft: index - 1,
      ArrowDown: index - 1,
      ArrowRight: index + 1,
      ArrowUp: index + 1,
      Home: 0,
      End: days.length - 1,
    }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    pick(target);
  }

  const difference = start && current ? current.price - start.price : 0;
  const note =
    noteFor === selected && difference !== 0
      ? t(difference < 0 ? "flight.stripCheaper" : "flight.stripPricier", {
          amount: formatAmount(Math.abs(difference), currency),
        }) + (current?.lowest ? ` · ${t("flight.stripLowest")}` : "")
      : "";
  const highest = Math.max(...days.map((day) => day.price));

  return (
    <div className="grid gap-1.5">
      {/* Mounted from the first render so a screen reader announces even the first change. */}
      <p role="status" className={touched ? "min-h-5 text-sm font-bold" : "sr-only"}>
        {note}
      </p>
      {!touched && (
        <div className="grid gap-1 text-sm text-ink-muted">
          <p>{t("flight.stripHint")}</p>
          <p aria-hidden="true" className="flex gap-3">
            {(["cheap", "normal", "pricey"] as const).map((key) => (
              <span key={key} className="flex items-center gap-1">
                <i className="strip-key" data-tone={key} />
                {toneLabel(key)}
              </span>
            ))}
          </p>
        </div>
      )}
      <div
        role="slider"
        tabIndex={0}
        aria-label={t("flight.stripDate")}
        aria-valuemin={0}
        aria-valuemax={days.length - 1}
        aria-valuenow={index}
        aria-valuetext={
          current
            ? `${friendlyDate(current.date)} · ${formatAmount(current.price, currency)} · ${toneLabel(current.tone)}${current.lowest ? ` · ${t("flight.stripLowest")}` : ""}`
            : undefined
        }
        data-motion={motion ? "full" : "reduced"}
        className="strip relative focus-visible:outline-2 focus-visible:outline-sprout-700"
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          dragging.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          pickAt(event);
        }}
        onPointerMove={(event) => {
          if (dragging.current) pickAt(event);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
      >
        {days.map((day) => (
          <div key={day.date} aria-hidden="true" className="strip-col">
            <span className="strip-label">{day.lowest ? t("flight.stripLowest") : ""}</span>
            <span className="strip-label">
              {day.date === selected ? formatAmount(day.price, currency) : ""}
            </span>
            <span
              className="strip-bar"
              data-tone={day.tone}
              data-selected={day.date === selected ? "true" : undefined}
              style={{
                height: `calc((100% - 3.75rem) * ${String(Math.max(0.2, day.price / highest))})`,
              }}
            />
            <span className="text-xs text-ink-muted">{shortDate(day.date)}</span>
          </div>
        ))}
        {!touched && motion && <span data-ghost aria-hidden="true" className="strip-ghost" />}
      </div>
    </div>
  );
}
