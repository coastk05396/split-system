import {
  formatAmount,
  isStandardSearch,
  partyOf,
  type FlightCard,
  type FlightSearchIntent,
  type FlightSearchReply,
} from "@split/shared";
import { useEffect, useState, type CSSProperties } from "react";
import { travelButton } from "../groups/ui.js";
import { t } from "../i18n/messages.js";
import { prefersReducedMotion } from "../shell/motion.js";
import { FlightPriceWatchButton } from "./FlightPriceWatches.js";
import { cabinText, whoText } from "./PartyPanel.js";

/** What the fares are ordered by and which way; the default is price, cheapest first. */
export type FareSort = { key: "price" | "time"; descending: boolean };
export const DEFAULT_SORT: FareSort = { key: "price", descending: false };

/** A just-saved Price Watch; `at` replays the animation when the same fare is watched again. */
export type SavedWatch = { card: FlightCard; at: number };

/** Rows shown before the 顯示全部 button. */
const FIRST_ROWS = 10;

/**
 * The results of a search: a skeleton while it runs, then one list of fare cards, cheapest first.
 * The empty and degraded notices keep their direct Google Flights link.
 */
export function FareResults({
  pending,
  reply,
  sort,
  onWatch,
  saved = null,
}: {
  pending: boolean;
  reply: FlightSearchReply | undefined;
  sort: FareSort;
  onWatch: (card: FlightCard) => void;
  /** The fare whose Price Watch was just saved: it plays the stamp and bell. */
  saved?: SavedWatch | null;
}) {
  if (!pending && !reply) return null;
  const party = partyOf(reply?.intent ?? {});
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
            {reply.cards.length === 0 && party.cabin !== "economy"
              ? t("flight.emptyCabin", { cabin: cabinText(party.cabin) })
              : t(reply.degraded ? "flight.degraded" : "flight.empty")}
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
        <FareList
          // Keyed by date so a new day folds the list back to its first rows.
          key={reply.intent.departureDate}
          cards={sortFares(reply.cards, sort)}
          sort={sort}
          onWatch={onWatch}
          saved={saved}
          motion={motion}
          note={footnote(reply.intent)}
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

/** Red-eye: departs before 05:00 or from 22:00. Reads "HH:MM" and the source's "YYYY-MM-DDTHH:MM"; anything else is not red-eye. */
function isRedEye(departure: string): boolean {
  const hour = /(?:T|^)(\d{1,2}):\d{2}/.exec(departure)?.[1];
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

/** Carousel-shaped placeholders; a scan line sweeps them only when motion is allowed. */
function FareSkeleton({ motion }: { motion: boolean }) {
  return (
    <div className="car-wrap">
      <div
        aria-hidden="true"
        data-motion={motion ? "full" : "reduced"}
        className="car car-skeleton"
      >
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="fare relative grid content-start gap-3 overflow-hidden rounded-[20px] border border-sprout-200 bg-white px-4 py-3.5"
          >
            <span className="h-4 w-1/3 rounded-full bg-sprout-100" />
            <span className="h-7 w-full rounded-full bg-sprout-100" />
            <span className="h-4 w-1/2 rounded-full bg-sprout-100" />
            <span className="h-6 w-2/5 rounded-full bg-sprout-100" />
            {motion && <span className="scan" />}
          </div>
        ))}
      </div>
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

/** The standard 1 adult economy round trip keeps its original note; anything else names the party. */
function footnote(intent: FlightSearchIntent): string {
  if (isStandardSearch(intent)) return t("flight.footnote");
  const party = partyOf(intent);
  return t("flight.footnoteParty", {
    trip: t(party.oneWay ? "flight.totalOne" : "flight.totalRound"),
    who: whoText(party.adults, party.children),
    cabin: cabinText(party.cabin),
  });
}

function FareList({
  cards,
  sort,
  onWatch,
  saved,
  motion,
  note,
}: {
  note: string;
  cards: FlightCard[];
  sort: FareSort;
  onWatch: (card: FlightCard) => void;
  saved: SavedWatch | null;
  motion: boolean;
}) {
  const [all, setAll] = useState(false);
  const [carousel, setCarousel] = useState(true);
  const [active, setActive] = useState(0);
  const shown = all ? cards : cards.slice(0, FIRST_ROWS);
  const keys = rowKeys(shown);
  return (
    <>
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 className="text-[22px] font-black">{t("flight.listTitle")}</h2>
        <span className="shrink-0 text-[13px] font-medium text-ink-muted">
          {t(`flight.order.${sort.key}.${sort.descending ? "desc" : "asc"}`)}
        </span>
        <button
          type="button"
          aria-label={t(carousel ? "flight.viewList" : "flight.viewSwipe")}
          className="press-pill grid size-11 shrink-0 place-items-center text-sprout-900 focus-visible:outline-2 focus-visible:outline-sprout-700"
          onClick={() => {
            setCarousel((c) => !c);
          }}
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="size-5 fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
          >
            <path d={carousel ? "M4 6h16M4 12h16M4 18h16" : "M7 5h10v14H7zM3 8v8M21 8v8"} />
          </svg>
        </button>
      </div>
      <div className={carousel ? "car-wrap" : undefined}>
        <ul
          aria-label={t("flight.fares")}
          data-view={carousel ? "carousel" : "list"}
          data-motion={motion ? "full" : "reduced"}
          className={carousel ? "car" : "grid gap-2.5"}
          onScroll={(event) => {
            // One snap step is a card plus the 12 px gap.
            const car = event.currentTarget;
            const step = (car.firstElementChild as HTMLElement | null)?.offsetWidth ?? 0;
            setActive(
              Math.min(shown.length - 1, Math.max(0, Math.round(car.scrollLeft / (step + 12)))),
            );
          }}
        >
          {shown.map((card, index) => (
            <FareCardItem
              key={keys[index]}
              card={card}
              tags={fareTags(card, cards)}
              onWatch={onWatch}
              active={carousel && index === active}
              saved={saved?.card === card ? saved.at : null}
              motion={motion}
            />
          ))}
        </ul>
        {carousel && shown.length > 1 && (
          <div aria-hidden="true" className="dots">
            {shown.map((_, index) => (
              <i key={keys[index]} data-dot={index === active ? "on" : "off"} />
            ))}
          </div>
        )}
      </div>
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
      <p className="px-1 text-[13px] leading-normal font-medium text-ink-muted">{note}</p>
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

/** Ten particles fly from the bell: fixed angles and distances, so a replay looks the same. */
const BURST = Array.from({ length: 10 }, (_, k) => {
  const angle = (k / 10) * Math.PI * 2;
  const radius = 26 + (k % 3) * 9;
  return [Math.round(Math.cos(angle) * radius), Math.round(Math.sin(angle) * radius)] as const;
});
const burstStyle = (dx: number, dy: number) =>
  ({ "--dx": `${String(dx)}px`, "--dy": `${String(dy)}px` }) as CSSProperties;

/** Milliseconds per step of a rolling digit. */
const FLAP_STEP_MS = 55;

/**
 * Text whose digits roll like a split-flap board before settling, left to right. Screen readers
 * get the whole text once; the rolling digits are hidden from them. Under reduced motion it is
 * plain text. Remount it (key) to roll again.
 */
function Flap({ text, className }: { text: string; className?: string }) {
  const [tick, setTick] = useState(() => (prefersReducedMotion() ? Infinity : 0));
  const digits = Array.from(text).filter((c) => c >= "0" && c <= "9").length;
  const rolling = tick <= 6 + 2 * Math.max(0, digits - 1);
  useEffect(() => {
    if (!rolling) return;
    const id = setTimeout(() => {
      setTick(prefersReducedMotion() ? Infinity : tick + 1);
    }, FLAP_STEP_MS);
    return () => {
      clearTimeout(id);
    };
  }, [tick, rolling]);
  let n = -1;
  return (
    <span data-flap="" data-rolling={rolling ? "true" : undefined} className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {Array.from(text).map((c, i) => {
          if (c < "0" || c > "9") return c;
          n += 1;
          const shown = tick > 6 + 2 * n ? c : String((Number(c) + tick * 3 + n * 7) % 10);
          return (
            <i key={i} className="ft">
              {shown}
            </i>
          );
        })}
      </span>
    </span>
  );
}

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
  active,
  saved,
  motion,
}: {
  card: FlightCard;
  tags: FareTag[];
  onWatch: (card: FlightCard) => void;
  active: boolean;
  /** When this fare's Price Watch was just saved, else null. */
  saved: number | null;
  motion: boolean;
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
      data-active={active ? "true" : undefined}
      className="fare relative rounded-[20px] border border-sprout-200 bg-white data-[strong=true]:border-[#f0c978] data-[strong=true]:border-l-[6px] data-[strong=true]:border-l-[#f2a33a] data-[strong=true]:bg-[#fff8e8]"
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
        </span>
        <span className="flex items-center gap-2.5 text-[15px] font-bold tabular-nums">
          <Flap key={card.outboundDeparture} text={card.outboundDeparture} />
          <span aria-hidden="true" className="relative flex h-4 flex-1 items-center">
            <span className="h-0 w-full border-t-2 border-dashed border-sprout-200" />
            <svg viewBox="0 0 24 24" className="fare-plane size-4 fill-sprout-700">
              <path d={PLANE} />
            </svg>
          </span>
          <Flap key={card.outboundArrival} text={card.outboundArrival} />
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
        <Flap
          key={card.price}
          text={formatAmount(card.price, card.intent.currency)}
          className="block min-h-11 pr-12 text-[26px] leading-[44px] font-black text-sprout-900 tabular-nums"
        />
      </a>
      <span className="absolute right-1 bottom-1">
        <FlightPriceWatchButton card={card} onWatch={onWatch} ring={motion ? saved : null} />
        {saved !== null && (
          <span role="status" className="sr-only">
            {t("flight.watchAdded")}
          </span>
        )}
        {saved !== null && motion && (
          <span key={saved} aria-hidden="true">
            <span className="stamp">{t("flight.stamp")}</span>
            {BURST.map(([dx, dy]) => (
              <i key={`${String(dx)},${String(dy)}`} className="pt" style={burstStyle(dx, dy)} />
            ))}
          </span>
        )}
      </span>
    </li>
  );
}
