import { formatAmount, type FlightCard, type FlightSearchReply } from "@split/shared";
import { useState } from "react";
import { travelButton } from "../groups/ui.js";
import { t } from "../i18n/messages.js";
import { prefersReducedMotion } from "../shell/motion.js";
import { FlightPriceWatchButton } from "./FlightPriceWatches.js";
import { cardsOnDate } from "./DateTiles.js";

/** What the fares are ordered by and which way; the default is price, cheapest first. */
export type FareSort = { key: "price" | "time"; descending: boolean };
export const DEFAULT_SORT: FareSort = { key: "price", descending: false };

/** Rows shown before the 顯示全部 button. */
const FIRST_ROWS = 10;

/**
 * The results of a search: a skeleton while it runs, then one list of fare cards, cheapest first.
 * The empty and degraded notices keep their direct Google Flights link.
 */
export function FareResults({
  pending,
  reply,
  date,
  sort,
  onWatch,
}: {
  pending: boolean;
  reply: FlightSearchReply | undefined;
  /** Shows only the fares departing on this date (the date tile selection). */
  date?: string | undefined;
  sort: FareSort;
  onWatch: (card: FlightCard) => void;
}) {
  if (!pending && !reply) return null;
  const motion = !prefersReducedMotion();
  return (
    <section
      aria-label={t("flight.results")}
      aria-busy={pending ? "true" : undefined}
      className="mt-4 grid gap-3"
    >
      {pending && (
        <>
          <p role="status" className="text-ink-muted">
            {t("flight.searching")}
          </p>
          <FareSkeleton motion={motion} />
        </>
      )}
      {reply && (reply.degraded || reply.cards.length === 0) && (
        <div className="surface-card rounded-3xl border border-sprout-200 bg-white p-5">
          <p className="mb-4 text-ink-muted">
            {t(reply.degraded ? "flight.degraded" : "flight.empty")}
          </p>
          <a
            href={reply.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`${travelButton} px-6 py-4`}
          >
            {t("flight.view")}
          </a>
        </div>
      )}
      {reply && reply.cards.length > 0 && (
        // Keyed by date so a switch folds the list back to its first rows.
        <FareList
          key={date ?? ""}
          cards={sortFares(cardsOnDate(reply.cards, date), sort)}
          sort={sort}
          onWatch={onWatch}
        />
      )}
    </section>
  );
}

/**
 * One list in the chosen order. Time orders by outbound departure ("HH:MM" compares as text) and
 * breaks ties by price; Array.sort is stable, so equal fares keep the reply's order.
 */
export function sortFares(cards: FlightCard[], sort: FareSort = DEFAULT_SORT): FlightCard[] {
  const sign = sort.descending ? -1 : 1;
  const byTime = (a: FlightCard, b: FlightCard) =>
    a.outboundDeparture < b.outboundDeparture
      ? -1
      : a.outboundDeparture > b.outboundDeparture
        ? 1
        : 0;
  return [...cards].sort(
    (a, b) => sign * (sort.key === "time" ? byTime(a, b) || a.price - b.price : a.price - b.price),
  );
}

type FareTag = "cheapest" | "fastest" | "redEye";

/** Red-eye: departs before 05:00 or from 22:00. Anything that is not "HH:MM" is not red-eye. */
function isRedEye(departure: string): boolean {
  const hour = /^(\d{1,2}):\d{2}/.exec(departure)?.[1];
  return hour !== undefined && (Number(hour) < 5 || Number(hour) >= 22);
}

/** Tags for one fare of the shown set: fares tied at the lowest price or shortest duration all get one. */
function fareTags(card: FlightCard, cards: FlightCard[]): FareTag[] {
  const tags: FareTag[] = [];
  if (card.price === Math.min(...cards.map((c) => c.price))) tags.push("cheapest");
  if (card.durationMinutes === Math.min(...cards.map((c) => c.durationMinutes)))
    tags.push("fastest");
  if (isRedEye(card.outboundDeparture)) tags.push("redEye");
  return tags;
}

/** Card-shaped placeholders; they pulse only when motion is allowed. */
function FareSkeleton({ motion }: { motion: boolean }) {
  return (
    <div
      aria-hidden="true"
      data-motion={motion ? "full" : "reduced"}
      className="fare-skeleton grid gap-2.5"
    >
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="grid gap-3 rounded-[20px] border border-sprout-200 bg-white px-4 py-3.5"
        >
          <span className="flex items-center justify-between">
            <span className="h-4 w-1/3 rounded-full bg-sprout-100" />
            <span className="h-5 w-24 rounded-full bg-sprout-100" />
          </span>
          <span className="h-4 w-full rounded-full bg-sprout-100" />
          <span className="h-3 w-1/2 rounded-full bg-sprout-100" />
        </div>
      ))}
    </div>
  );
}

/** Stable row keys from the fare itself; a repeated fare gets a "#n" suffix so keys stay unique. */
function rowKeys(cards: FlightCard[]): string[] {
  const seen = new Map<string, number>();
  return cards.map((card) => {
    const key = `${card.url}|${card.airline}|${card.outboundDeparture}|${String(card.price)}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    return n === 0 ? key : `${key}#${String(n)}`;
  });
}

function FareList({
  cards,
  sort,
  onWatch,
}: {
  cards: FlightCard[];
  sort: FareSort;
  onWatch: (card: FlightCard) => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? cards : cards.slice(0, FIRST_ROWS);
  const keys = rowKeys(shown);
  return (
    <>
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 className="text-[22px] font-black">{t("flight.listTitle")}</h2>
        <span className="shrink-0 text-[13px] font-medium text-ink-muted">
          {t(`flight.order.${sort.key}.${sort.descending ? "desc" : "asc"}`)}
        </span>
      </div>
      <ul aria-label={t("flight.fares")} className="grid gap-2.5">
        {shown.map((card, index) => (
          <FareCardItem
            key={keys[index]}
            card={card}
            tags={fareTags(card, cards)}
            onWatch={onWatch}
          />
        ))}
      </ul>
      {!all && cards.length > FIRST_ROWS && (
        <button
          type="button"
          className="press-pill flex min-h-[52px] items-center justify-center gap-2 rounded-full border-[1.5px] border-sprout-700 bg-white px-5 text-base font-bold text-sprout-900 focus-visible:outline-2 focus-visible:outline-sprout-700"
          onClick={() => {
            setAll(true);
          }}
        >
          {t("flight.showAll", { n: cards.length })}
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="size-[18px] fill-none stroke-current stroke-[2.2] [stroke-linecap:round] [stroke-linejoin:round]"
          >
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      )}
      <p className="px-1 text-[13px] leading-normal font-medium text-ink-muted">
        {t("flight.footnote")}
      </p>
    </>
  );
}

/** Tag colours, none amber (amber is only for 最低 and 強烈買): white on #26684b, #245b41 on #e4f9e9, white on #2b3a6b. */
const TAG_CLASS: Record<FareTag, string> = {
  cheapest: "rounded-lg bg-sprout-600 px-2 py-0.5 text-xs font-bold text-white",
  fastest:
    "rounded-lg border border-sprout-700 bg-sprout-100 px-2 py-0.5 text-xs font-bold text-sprout-700",
  redEye: "rounded-lg bg-[#2b3a6b] px-2 py-0.5 text-xs font-bold text-white",
};

const PLANE =
  "M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z";

/** "2 h 40 min" or "3 h"; nothing when the source gave no duration. */
function duration(minutes: number): string | undefined {
  if (!(minutes > 0)) return undefined;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0
    ? t("flight.durationHours", { hours })
    : t("flight.duration", { hours, minutes: rest });
}

/**
 * One fare as a card: airline with its tag and the price on top, the departure-to-arrival time
 * line, then stops and duration. A Strong Buy card has an amber edge and a cream background; it
 * is the only highlighted kind. The card is a link to Google Flights, with the Price Watch bell
 * beside it, not inside it.
 */
function FareCardItem({
  card,
  tags,
  onWatch,
}: {
  card: FlightCard;
  tags: FareTag[];
  onWatch: (card: FlightCard) => void;
}) {
  const strong = card.signal === "strong_buy";
  const stops =
    card.stops === 0
      ? t("flight.nonstop")
      : t(card.stops === 1 ? "flight.oneStop" : "flight.stops", { n: card.stops });
  const took = duration(card.durationMinutes);
  return (
    <li
      data-strong={strong ? "true" : undefined}
      className="relative rounded-[20px] border border-sprout-200 bg-white data-[strong=true]:border-[#f0c978] data-[strong=true]:border-l-[6px] data-[strong=true]:border-l-[#f2a33a] data-[strong=true]:bg-[#fff8e8]"
    >
      <a
        href={card.url}
        target="_blank"
        rel="noopener noreferrer"
        className="grid gap-2.5 rounded-[inherit] px-4 py-3.5 focus-visible:outline-2 focus-visible:outline-sprout-700"
      >
        <span className="flex items-center justify-between gap-2.5">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="text-[17px] font-bold">{card.airline}</span>
            {strong ? (
              <span className="sticker">
                <svg viewBox="0 0 24 24" aria-hidden="true" className="size-3 fill-current">
                  <path d="M13 2 4 14h6l-1 8 9-12h-6z" />
                </svg>
                {t("flight.sticker")}
              </span>
            ) : (
              card.top === true && (
                <span className="rounded-lg border border-sprout-200 bg-sprout-100 px-2 py-0.5 text-xs font-bold text-sprout-700">
                  {t("flight.top")}
                </span>
              )
            )}
            {tags.map((tag) => (
              <span key={tag} className={TAG_CLASS[tag]}>
                {t(`flight.tag.${tag}`)}
              </span>
            ))}
          </span>
          <span className="shrink-0 text-[22px] font-black text-sprout-900 tabular-nums">
            {formatAmount(card.price, card.intent.currency)}
          </span>
        </span>
        <span className="flex items-center gap-2.5 text-[15px] font-bold tabular-nums">
          <span>{card.outboundDeparture}</span>
          <span aria-hidden="true" className="flex flex-1 items-center gap-1.5">
            <span className="h-0.5 flex-1 rounded-full bg-sprout-200" />
            <svg viewBox="0 0 24 24" className="size-4 fill-sprout-700">
              <path d={PLANE} />
            </svg>
            <span className="h-0.5 flex-1 rounded-full bg-sprout-200" />
          </span>
          <span>{card.outboundArrival}</span>
        </span>
        <span className="pr-11 text-[13px] font-medium text-ink-muted">
          {took ? t("flight.meta", { stops, duration: took }) : stops}
        </span>
        {card.history && card.history.days >= 14 && (
          <>
            <span className="text-[13px] text-ink-muted">
              {t(
                card.history.percentBelowMean >= 0 ? "flight.historyBelow" : "flight.historyAbove",
                { percent: Math.abs(card.history.percentBelowMean), days: card.history.days },
              )}
            </span>
            <span className="text-[13px] text-ink-muted">
              {t("flight.percentile", { percentile: card.history.percentile })}
            </span>
          </>
        )}
        {card.overBudget > 0 && (
          <span className="text-[13px] text-red-700">
            {t("flight.overBudget", {
              amount: formatAmount(card.overBudget, card.intent.currency),
            })}
          </span>
        )}
      </a>
      <span className="absolute right-1 bottom-1">
        <FlightPriceWatchButton card={card} onWatch={onWatch} />
      </span>
    </li>
  );
}
