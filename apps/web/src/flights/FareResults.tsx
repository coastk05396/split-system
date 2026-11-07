import { formatAmount, type FlightCard, type FlightSearchReply } from "@split/shared";
import { useRef, useState } from "react";
import { primaryButton } from "../groups/ui.js";
import { t } from "../i18n/messages.js";
import { prefersReducedMotion } from "../shell/motion.js";
import { FlightPriceWatchButton } from "./FlightPriceWatches.js";
import { cardsOnDate } from "./PriceStrip.js";
import { SplitFlap } from "./SplitFlap.js";

/**
 * The results of a search: a skeleton while it runs, then the fares as a one-card-at-a-time
 * carousel with page dots. The empty and degraded notices keep their direct Google Flights link.
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
      className="mt-6 grid gap-4"
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
        // Keyed by date so a switch starts at the first card and the numbers roll again.
        <FareCarousel
          key={date}
          cards={cardsOnDate(reply.cards, date)}
          motion={motion}
          onWatch={onWatch}
        />
      )}
    </section>
  );
}

/** Three card-shaped placeholders; they pulse only when motion is allowed. */
function FareSkeleton({ motion }: { motion: boolean }) {
  return (
    <div aria-hidden="true" data-motion={motion ? "full" : "reduced"} className="fare-scroller">
      {[0, 1, 2].map((index) => (
        <div key={index} className="fare-card">
          <div className="fare-face fare-skeleton grid gap-3">
            <span className="h-4 w-1/2 rounded-full" />
            <span className="h-9 w-2/3 rounded-xl" />
            <span className="h-4 w-full rounded-full" />
            <span className="h-4 w-3/4 rounded-full" />
            <span className="mt-4 h-11 w-full rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

function FareCarousel({
  cards,
  motion,
  onWatch,
}: {
  cards: FlightCard[];
  motion: boolean;
  onWatch: (card: FlightCard) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const slides = () => Array.from(scroller.current?.children ?? []) as HTMLElement[];

  // The card whose middle is nearest the middle of the row is the one in focus.
  function onScroll() {
    const row = scroller.current;
    if (!row) return;
    const middle = row.scrollLeft + row.clientWidth / 2;
    let nearest = 0;
    let gap = Infinity;
    slides().forEach((slide, index) => {
      const distance = Math.abs(slide.offsetLeft + slide.offsetWidth / 2 - middle);
      if (distance < gap) {
        gap = distance;
        nearest = index;
      }
    });
    setActive(nearest);
  }

  return (
    <>
      <div
        ref={scroller}
        role="group"
        aria-label={t("flight.fares")}
        // A scroll container the keyboard can reach: arrow keys then scroll it.
        tabIndex={0}
        data-motion={motion ? "full" : "reduced"}
        className="fare-scroller focus-visible:outline-2 focus-visible:outline-sprout-700"
        onScroll={onScroll}
      >
        {cards.map((card, index) => (
          <article
            key={`${card.url}-${card.airline}-${card.outboundDeparture}-${card.price}`}
            aria-label={t("flight.farePage", { n: index + 1, total: cards.length })}
            data-active={index === active ? "true" : undefined}
            className="fare-card"
          >
            <FareFace card={card} roll={motion} onWatch={onWatch} />
          </article>
        ))}
      </div>
      {cards.length > 1 && (
        <div role="group" aria-label={t("flight.farePages")} className="flex justify-center">
          {cards.map((card, index) => (
            <button
              key={`${card.url}-${card.airline}-${card.outboundDeparture}-${card.price}`}
              type="button"
              aria-label={t("flight.farePage", { n: index + 1, total: cards.length })}
              aria-current={index === active ? "true" : undefined}
              className="fare-dot group focus-visible:outline-2 focus-visible:outline-sprout-700"
              onClick={() => {
                setActive(index);
                slides()[index]?.scrollIntoView({
                  behavior: motion ? "smooth" : "auto",
                  inline: "center",
                  block: "nearest",
                });
              }}
            />
          ))}
        </div>
      )}
    </>
  );
}

function FareFace({
  card,
  roll,
  onWatch,
}: {
  card: FlightCard;
  roll: boolean;
  onWatch: (card: FlightCard) => void;
}) {
  return (
    <div className="fare-face surface-card flex h-full flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-bold">
          {card.intent.origin} → {card.intent.destination}
        </h2>
        <span className="rounded-full bg-sprout-100 px-3 py-1 text-sm font-bold">
          {t(`flight.${card.signal}`)}
        </span>
      </div>
      <div aria-hidden="true" className="fare-track">
        <span className="fare-plane">
          <svg viewBox="0 0 24 24" className="size-4 rotate-90 fill-sprout-500">
            <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" />
          </svg>
        </span>
      </div>
      <p className="text-sm text-ink-muted">
        {card.intent.departureDate} – {card.intent.returnDate}
      </p>
      <p className="text-3xl font-bold">
        <SplitFlap text={formatAmount(card.price, card.intent.currency)} roll={roll} />
      </p>
      <p className="font-bold">{card.airline}</p>
      <p className="text-sm">
        {t("flight.outbound")}: <SplitFlap text={card.outboundDeparture} roll={roll} /> →{" "}
        <SplitFlap text={card.outboundArrival} roll={roll} />
      </p>
      <p className="text-sm">
        {card.inboundDeparture !== null && card.inboundArrival !== null ? (
          <>
            {t("flight.inbound")}: <SplitFlap text={card.inboundDeparture} roll={roll} /> →{" "}
            <SplitFlap text={card.inboundArrival} roll={roll} />
          </>
        ) : (
          t("flight.returnOnGoogle")
        )}
      </p>
      <p className="text-sm text-ink-muted">
        {t("flight.summary", { stops: card.stops, minutes: card.durationMinutes })}
      </p>
      {card.history && card.history.days >= 14 && (
        <div className="text-sm text-ink-muted">
          <p>
            {t(card.history.percentBelowMean >= 0 ? "flight.historyBelow" : "flight.historyAbove", {
              percent: Math.abs(card.history.percentBelowMean),
              days: card.history.days,
            })}
          </p>
          <p>{t("flight.percentile", { percentile: card.history.percentile })}</p>
        </div>
      )}
      {card.overBudget > 0 && (
        <p className="text-sm text-red-700">
          {t("flight.overBudget", {
            amount: formatAmount(card.overBudget, card.intent.currency),
          })}
        </p>
      )}
      <a
        href={card.url}
        target="_blank"
        rel="noopener noreferrer"
        className={`${primaryButton} mt-auto`}
      >
        {t("flight.view")}
      </a>
      <FlightPriceWatchButton card={card} onWatch={onWatch} />
    </div>
  );
}
