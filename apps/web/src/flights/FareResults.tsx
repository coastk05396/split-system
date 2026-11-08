import { formatAmount, type FlightCard, type FlightSearchReply } from "@split/shared";
import { useState } from "react";
import { primaryButton } from "../groups/ui.js";
import { t } from "../i18n/messages.js";
import { prefersReducedMotion } from "../shell/motion.js";
import { FlightPriceWatchButton } from "./FlightPriceWatches.js";
import { cardsOnDate } from "./PriceStrip.js";

/** Rows shown before the 顯示全部 button. */
const FIRST_ROWS = 10;

/**
 * The results of a search: a skeleton while it runs, then one compact list, cheapest first, with
 * the prices in one right-aligned column. The empty and degraded notices keep their direct Google
 * Flights link.
 */
export function FareResults({
  pending,
  reply,
  date,
  onWatch,
}: {
  pending: boolean;
  reply: FlightSearchReply | undefined;
  /** Shows only the fares departing on this date (the Price Strip's selection). */
  date?: string | undefined;
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
          <a href={reply.url} target="_blank" rel="noopener noreferrer" className={primaryButton}>
            {t("flight.view")}
          </a>
        </div>
      )}
      {reply && reply.cards.length > 0 && (
        // Keyed by date so a switch folds the list back to its first rows.
        <FareList
          key={date ?? ""}
          cards={sortFares(cardsOnDate(reply.cards, date))}
          onWatch={onWatch}
        />
      )}
    </section>
  );
}

/** One list, cheapest first; Array.sort is stable, so equal prices keep the reply's order. */
export function sortFares(cards: FlightCard[]): FlightCard[] {
  return [...cards].sort((a, b) => a.price - b.price);
}

/** Row-shaped placeholders; they pulse only when motion is allowed. */
function FareSkeleton({ motion }: { motion: boolean }) {
  return (
    <div
      aria-hidden="true"
      data-motion={motion ? "full" : "reduced"}
      className="fare-skeleton overflow-hidden rounded-2xl border border-sprout-200 bg-white"
    >
      {[0, 1, 2, 3].map((index) => (
        <div
          key={index}
          className="flex min-h-14 items-center justify-between gap-3 border-t border-sprout-100 px-4 py-2 first:border-t-0"
        >
          <span className="grid w-1/2 gap-2">
            <span className="h-4 w-2/3 rounded-full bg-sprout-100" />
            <span className="h-3 w-full rounded-full bg-sprout-100" />
          </span>
          <span className="h-5 w-24 rounded-full bg-sprout-100" />
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
  onWatch,
}: {
  cards: FlightCard[];
  onWatch: (card: FlightCard) => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? cards : cards.slice(0, FIRST_ROWS);
  const keys = rowKeys(shown);
  return (
    <>
      <p className="mx-1 text-sm text-ink-muted">
        {t("flight.listCount", { n: cards.length })}{" "}
        <span className="whitespace-nowrap">
          {t("flight.listPrices", { caption: t("flight.priceCaption") })}
        </span>
      </p>
      <ul
        aria-label={t("flight.fares")}
        className="surface-card overflow-hidden rounded-2xl border border-sprout-200 bg-white"
      >
        {shown.map((card, index) => (
          <FareRow key={keys[index]} card={card} onWatch={onWatch} />
        ))}
      </ul>
      {!all && cards.length > FIRST_ROWS && (
        <button
          type="button"
          className="press-pill min-h-12 rounded-full border-[1.5px] border-sprout-900 bg-white px-5 font-bold focus-visible:outline-2 focus-visible:outline-sprout-700"
          onClick={() => {
            setAll(true);
          }}
        >
          {t("flight.showAll", { n: cards.length })}
        </button>
      )}
    </>
  );
}

function FareRow({ card, onWatch }: { card: FlightCard; onWatch: (card: FlightCard) => void }) {
  return (
    <li className="flex items-center border-t border-sprout-100 first:border-t-0">
      <a
        href={card.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex min-h-14 min-w-0 flex-1 items-center justify-between gap-3 py-2 pl-4 focus-visible:outline-2 focus-visible:outline-sprout-700"
      >
        <span className="grid min-w-0 gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-bold">{card.airline}</span>
            {card.signal === "strong_buy" ? (
              <span className="sticker">
                <svg viewBox="0 0 24 24" aria-hidden="true" className="size-3 fill-current">
                  <path d="M13 2 4 14h6l-1 8 9-12h-6z" />
                </svg>
                {t("flight.sticker")}
              </span>
            ) : (
              card.top === true && (
                <span className="rounded-lg bg-sprout-100 px-2 py-0.5 text-xs font-bold">
                  {t("flight.top")}
                </span>
              )
            )}
          </span>
          <span className="flex flex-wrap gap-x-1 text-[13px] text-ink-muted">
            <span className="whitespace-nowrap">
              {card.outboundDeparture} – {card.outboundArrival}・
            </span>
            <span className="whitespace-nowrap">
              {card.stops === 0
                ? t("flight.nonstop")
                : t(card.stops === 1 ? "flight.oneStop" : "flight.stops", { n: card.stops })}
            </span>
          </span>
          {card.history && card.history.days >= 14 && (
            <>
              <span className="text-[13px] text-ink-muted">
                {t(
                  card.history.percentBelowMean >= 0
                    ? "flight.historyBelow"
                    : "flight.historyAbove",
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
        </span>
        <span className="shrink-0 text-lg font-black tabular-nums">
          {formatAmount(card.price, card.intent.currency)}
        </span>
      </a>
      <FlightPriceWatchButton card={card} onWatch={onWatch} />
    </li>
  );
}
