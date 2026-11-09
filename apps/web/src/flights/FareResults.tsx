import {
  formatAmount,
  isStandardSearch,
  partyOf,
  type FlightCard,
  type FlightSearchIntent,
  type FlightSearchReply,
} from "@split/shared";
import { useEffect, useState, type CSSProperties } from "react";
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
  carousel = true,
  onWatch,
  saved = null,
}: {
  pending: boolean;
  reply: FlightSearchReply | undefined;
  sort: FareSort;
  /** Swipe row (the mock's look) or the plain vertical list; the toggle sits in the sort bar. */
  carousel?: boolean;
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
      className="fr-res"
    >
      {pending && (
        <>
          <p role="status" className="fr-ldt">
            {t("flight.searching")}
          </p>
          <FareSkeleton motion={motion} />
        </>
      )}
      {reply && (reply.degraded || reply.cards.length === 0) && (
        <>
          <div className="fr-nya">
            <i aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path
                  d="M12 21v-9"
                  stroke="#fff"
                  strokeWidth="2"
                  strokeLinecap="round"
                  fill="none"
                />
                <path d="M12 13c0-4 2.6-6.6 7-6.6 0 4.2-2.8 6.6-7 6.6z" fill="#fff" />
                <path d="M12 15c0-3-2-5-5.6-5 0 3.2 2.2 5 5.6 5z" fill="#d6f3e3" />
              </svg>
            </i>
            <p>
              {reply.cards.length === 0 && party.cabin !== "economy"
                ? t("flight.emptyCabin", { cabin: cabinText(party.cabin) })
                : t(reply.degraded ? "flight.degraded" : "flight.empty")}
            </p>
          </div>
          <a href={reply.url} target="_blank" rel="noopener noreferrer" className="fr-alt fr-hit">
            {t("flight.view")}
          </a>
        </>
      )}
      {reply && reply.cards.length > 0 && (
        <FareList
          // Keyed by date so a new day folds the list back to its first rows.
          key={reply.intent.departureDate}
          cards={sortFares(reply.cards, sort)}
          sort={sort}
          carousel={carousel}
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

/** The mock's skeleton cards; a scan line sweeps them only when motion is allowed. */
function FareSkeleton({ motion }: { motion: boolean }) {
  return (
    <>
      <div aria-hidden="true" data-motion={motion ? "full" : "reduced"} className="grid gap-3.5">
        {[0, 1, 2].map((index) => (
          <div key={index} className="fr-sk">
            <i />
            <i />
            <i />
          </div>
        ))}
      </div>
      {motion && <span aria-hidden="true" className="scan" />}
    </>
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
  const party = partyOf(intent);
  // The source never prices infants, so the shown total leaves them out and says so.
  const infants = party.infants > 0 ? ` ${t("flight.infantNote")}.` : "";
  if (isStandardSearch(intent)) return t("flight.footnote") + infants;
  return (
    t("flight.footnoteParty", {
      trip: t(party.oneWay ? "flight.totalOne" : "flight.totalRound"),
      who: whoText(party.adults, party.children),
      cabin: cabinText(party.cabin),
    }) + infants
  );
}

function FareList({
  cards,
  sort,
  carousel,
  onWatch,
  saved,
  motion,
  note,
}: {
  note: string;
  cards: FlightCard[];
  sort: FareSort;
  carousel: boolean;
  onWatch: (card: FlightCard) => void;
  saved: SavedWatch | null;
  motion: boolean;
}) {
  const [all, setAll] = useState(false);
  const [active, setActive] = useState(0);
  const shown = all ? cards : cards.slice(0, FIRST_ROWS);
  const keys = rowKeys(shown);
  return (
    <>
      {/* The mock has no heading row: the title and the order stay for screen readers. */}
      <div className="sr-only">
        <h2>{t("flight.listTitle")}</h2>
        <span>{t(`flight.order.${sort.key}.${sort.descending ? "desc" : "asc"}`)}</span>
      </div>
      <div className={carousel ? "car-wrap" : undefined}>
        <ul
          aria-label={t("flight.fares")}
          data-view={carousel ? "carousel" : "list"}
          data-motion={motion ? "full" : "reduced"}
          className={carousel ? "fr-car" : "grid gap-2.5"}
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
          <div aria-hidden="true" className="fr-dots">
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
      <p className="sr-only">{note}</p>
    </>
  );
}

/** The mock's tag chips: white on #26684b, #245b41 on #e4f9e9, white on #2b3a6b (none amber). */
const TAG_CLASS: Record<FareTag, string> = {
  cheapest: "fr-tg2 c",
  fastest: "fr-tg2",
  redEye: "fr-tg2 r",
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
 * plain text. Remount it (key) to roll again. With `lead`, the text before the first digit (a
 * currency sign) is shown small and still, and `className` styles the digits.
 */
function Flap({
  text,
  className,
  lead = false,
  outer,
}: {
  text: string;
  className?: string;
  lead?: boolean;
  outer?: string;
}) {
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
  const prefix = lead ? (/^\D*/.exec(text)?.[0] ?? "") : "";
  const rest = text.slice(prefix.length);
  let n = -1;
  return (
    <span data-flap="" data-rolling={rolling ? "true" : undefined} className={outer}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {prefix.trim() && (
          <>
            <small>{prefix.trim()}</small>{" "}
          </>
        )}
        <span className={className}>
          {Array.from(rest).map((c, i) => {
            if (c < "0" || c > "9")
              return (
                <span key={i} className="fs">
                  {c}
                </span>
              );
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

/** "2h 40m" for the chip on the route line. */
function shortDuration(minutes: number): string | undefined {
  if (!(minutes > 0)) return undefined;
  return t("flight.legDuration", {
    hours: Math.floor(minutes / 60),
    minutes: String(minutes % 60).padStart(2, "0"),
  });
}

/**
 * One fare as the mock's ticket: airline with its tag on top, the route line (codes, plane,
 * duration chip), the times with the tags between them, then the price and the Price Watch
 * button. The card is a link to Google Flights (the airline name stretches over the card),
 * the Price Watch button sits above it, not inside it.
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
  const chip = shortDuration(card.durationMinutes);
  return (
    <li
      data-strong={strong ? "true" : undefined}
      data-active={active ? "true" : undefined}
      className="fr-fare"
    >
      <div className="fr-fi">
        <div className="fr-front">
          <div className="fr-fh">
            <i aria-hidden="true">{Array.from(card.airline.trim()).slice(0, 2).join("")}</i>
            <a href={card.url} target="_blank" rel="noopener noreferrer" className="fr-stretch">
              {card.airline}
            </a>
            {!strong && card.top === true && <span className="fr-sig">{t("flight.top")}</span>}
            {strong ? (
              <span className="sticker fr-sig">{t("flight.sticker")}</span>
            ) : (
              <span className={`fr-sig fr-sig-${card.signal}`}>
                {t(card.signal === "buy" ? "flight.buy" : "flight.hold")}
              </span>
            )}
          </div>
          <div className="fr-fl" aria-hidden="true">
            <b>{card.intent.origin}</b>
            <div className="fr-path">
              <svg viewBox="0 0 24 24" className="fare-plane">
                <path d={PLANE} />
              </svg>
              {chip && <span>{chip}</span>}
            </div>
            <b>{card.intent.destination}</b>
          </div>
          <div className="fr-fm">
            <Flap key={card.outboundDeparture} text={card.outboundDeparture} outer="fr-tm" />
            <span className="fr-chs">
              {tags.map((tag) => (
                <em key={tag} className={TAG_CLASS[tag]}>
                  {t(`flight.tag.${tag}`)}
                </em>
              ))}
            </span>
            <Flap key={card.outboundArrival} text={card.outboundArrival} outer="fr-tm" />
          </div>
          <p className="sr-only">{took ? t("flight.meta", { stops, duration: took }) : stops}</p>
          {card.history && card.history.days >= 14 && (
            <>
              <p className="sr-only">
                {t(
                  card.history.percentBelowMean >= 0
                    ? "flight.historyBelow"
                    : "flight.historyAbove",
                  { percent: Math.abs(card.history.percentBelowMean), days: card.history.days },
                )}
              </p>
              <p className="sr-only">
                {t("flight.percentile", { percentile: card.history.percentile })}
              </p>
            </>
          )}
          {card.overBudget > 0 && (
            <p className="sr-only">
              {t("flight.overBudget", {
                amount: formatAmount(card.overBudget, card.intent.currency),
              })}
            </p>
          )}
          <div className="fr-ff">
            <strong>
              <Flap
                key={card.price}
                text={formatAmount(card.price, card.intent.currency)}
                lead
                outer="tabular-nums"
                className="fr-pn"
              />
            </strong>
            <FlightPriceWatchButton card={card} onWatch={onWatch} ring={motion ? saved : null} />
          </div>
        </div>
      </div>
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
    </li>
  );
}
