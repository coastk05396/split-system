import {
  formatAmount,
  type CurrencyCode,
  type FlightPriceStripReply,
  type FlightSearchIntent,
} from "@split/shared";
import { useQueries } from "@tanstack/react-query";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { useAuth } from "../auth/AuthProvider.js";
import { readWithRev } from "../groups/data.js";
import { t } from "../i18n/messages.js";
import { prefersReducedMotion } from "../shell/motion.js";
import { addDays, friendlyDate, shortDate } from "./dates.js";
import { StickyBar } from "./StickyBar.js";

const HOUR = 3_600_000;
/** Saved prices older than this say how old they are. */
const OLD_AFTER_HOURS = 6;
const SKELETON_HEIGHTS = [45, 70, 55, 85, 60, 40, 75, 90, 50, 65];
const BARS = 30;
/** A day with no saved price is this tall; priced bars span the rest of the 62 px. */
const EMPTY_PX = 10;
/** Arrow keys and jumps search once they stop for this long, so a run of presses is one search. */
const SETTLE_MS = 400;

type Kind = "cheap" | "normal" | "pricey" | "none";

/** Ten days before the departure day, never in the past: the first of the 30 bars. */
function firstBar(departure: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const start = addDays(departure, -10);
  return start < today ? today : start;
}

/** Read-only: the endpoint serves stored Fare Snapshots and never starts a search (ADR 0007). */
export function usePriceStrip(
  origin: string,
  destination: string,
  currency: CurrencyCode,
  months: string[],
) {
  const { session } = useAuth();
  return useQueries({
    queries: months.map((month) => ({
      queryKey: ["flights", "price-strip", origin, destination, currency, month],
      // An unavailable line beats a long retry wait; the strip must never spin for long.
      retry: false,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        readWithRev<FlightPriceStripReply>(
          session.fetch(
            `/api/v1/flights/price-strip?${new URLSearchParams({ origin, destination, currency, month }).toString()}`,
            { signal },
          ),
        ),
    })),
    combine: (results) => ({
      pending: results.some((r) => r.isPending),
      days: results.flatMap((r) => r.data?.days ?? []),
    }),
  });
}

/** The amount in full without its currency symbol, which would not fit the tooltip. */
const plainAmount = (price: number, currency: CurrencyCode) =>
  formatAmount(price, currency).replace(/^\S+\s/, "");

/**
 * The 30 days from ten days before the departure day, as bars of the cheapest saved Fare Snapshot
 * per day (never a live search). Dragging or the arrow keys move the chosen day; once it settles
 * the page searches that date live (`onPick`). Cheap, normal and pricey are the cheapest third,
 * the dearest fifth and the rest of the priced days in this window; a day with no price is dashed.
 */
export function PriceStrip({
  intent,
  onPick,
}: {
  intent: FlightSearchIntent;
  onPick: (date: string) => void;
}) {
  const heading = useId();
  const searched = intent.departureDate;
  // The window holds still while the chosen day stays in it, so the bars never slide under a drag.
  const window0 = useRef("");
  if (
    !window0.current ||
    searched < window0.current ||
    searched > addDays(window0.current, BARS - 1)
  )
    window0.current = firstBar(searched);
  const start = window0.current;
  const dates = Array.from({ length: BARS }, (_, i) => addDays(start, i));
  const months = [...new Set([start.slice(0, 7), addDays(start, BARS - 1).slice(0, 7)])];
  const { pending, days } = usePriceStrip(
    intent.origin,
    intent.destination,
    intent.currency,
    months,
  );
  const priceOf = new Map(days.map((day) => [day.date, day.price]));
  const prices = dates.map((date) => priceOf.get(date));

  // The day under the finger or key, until the search for it starts and the intent catches up.
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => {
    setDraft(null);
  }, [searched]);
  const chosen = draft ?? searched;
  const latest = useRef({ searched, onPick, chosen });
  latest.current = { searched, onPick, chosen };
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );
  const [wave, setWave] = useState<number | null>(null);
  const dragging = useRef(false);

  const commit = () => {
    clearTimeout(timer.current);
    const { searched: current, onPick: pick, chosen: day } = latest.current;
    if (day === current) setDraft(null);
    else pick(day);
  };
  const choose = (index: number, settle: "now" | "later" | "never") => {
    const next = dates[Math.min(BARS - 1, Math.max(0, index))] ?? searched;
    latest.current.chosen = next;
    setDraft(next);
    clearTimeout(timer.current);
    if (settle === "now") commit();
    else if (settle === "later") timer.current = setTimeout(commit, SETTLE_MS);
  };

  const index = Math.min(BARS - 1, Math.max(0, dates.indexOf(chosen)));
  const priced = prices.flatMap((p) => (p === undefined ? [] : [p]));
  const loaded = !pending && priced.length > 0;
  const low = Math.min(...priced);
  const high = Math.max(...priced);
  const sorted = [...priced].sort((a, b) => a - b);
  const cheapCut = sorted[Math.floor(sorted.length * 0.3)] ?? low;
  const priceyCut = sorted[Math.floor(sorted.length * 0.8)] ?? high;
  const kindOf = (price: number | undefined): Kind =>
    price === undefined
      ? "none"
      : price <= cheapCut
        ? "cheap"
        : price >= priceyCut
          ? "pricey"
          : "normal";

  const title = t("flight.stripTitle");
  if (!loaded)
    return (
      <section aria-labelledby={heading} className="mt-5 grid gap-2 px-1">
        <h2 id={heading} className="text-[17px] font-black">
          {title}
        </h2>
        {pending ? (
          <div
            role="status"
            aria-busy="true"
            aria-label={t("flight.stripLoading")}
            className="flex h-[72px] items-end gap-0.5"
          >
            {Array.from({ length: BARS }, (_, i) => (
              <div
                key={i}
                aria-hidden="true"
                className={`min-w-0 flex-1 rounded-t-sm bg-[#b3bbb6] ${prefersReducedMotion() ? "" : "strip-pulse"}`}
                style={{ height: `${String(SKELETON_HEIGHTS[i % SKELETON_HEIGHTS.length])}%` }}
              />
            ))}
          </div>
        ) : (
          <p className="text-[15px] font-bold text-ink-muted">{t("flight.stripUnavailable")}</p>
        )}
      </section>
    );

  const currency = intent.currency;
  const lowestIndex = prices.findIndex((p) => p === low);
  const oldestHours = Math.floor((Date.now() - Math.min(...days.map((d) => d.fetchedAt))) / HOUR);
  const chosenDate = dates[index] ?? searched;
  const chosenPrice = prices[index];
  const searchedPrice = priceOf.get(searched);
  const delta =
    chosenPrice !== undefined && searchedPrice !== undefined ? chosenPrice - searchedPrice : 0;
  const tipText = `${shortDate(chosenDate)} · ${chosenPrice === undefined ? t("flight.stripNoPrice") : formatAmount(chosenPrice, currency)}`;
  const valueText = `${friendlyDate(chosenDate)} · ${chosenPrice === undefined ? t("flight.stripNoPrice") : formatAmount(chosenPrice, currency)}${
    delta === 0
      ? ""
      : ` · ${t(delta < 0 ? "flight.stripCheaperThan" : "flight.stripPricierThan", {
          amount: formatAmount(Math.abs(delta), currency),
          date: shortDate(searched),
        })}`
  }`;
  // The return day keeps the stay of the searched trip as the chosen day moves.
  const stay = intent.returnDate
    ? Math.round((Date.parse(intent.returnDate) - Date.parse(searched)) / 86_400_000)
    : 0;
  const returnIndex = intent.returnDate ? dates.indexOf(addDays(chosenDate, stay)) : -1;
  const spanEnd = intent.returnDate ? Math.min(BARS - 1, index + stay) : index;

  const move = (event: PointerEvent<HTMLDivElement>, settle: "never" | "now") => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width === 0) return;
    const at = ((event.clientX - box.left) / box.width) * BARS;
    if (!prefersReducedMotion()) setWave(at - 0.5);
    choose(Math.floor(at), settle);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const now = Math.max(0, dates.indexOf(latest.current.chosen));
    // The ARIA slider keys: arrows by a day, Page keys by a week, Home and End to the ends.
    const target =
      event.key === "ArrowRight"
        ? now + 1
        : event.key === "ArrowLeft"
          ? now - 1
          : event.key === "PageUp"
            ? now + 7
            : event.key === "PageDown"
              ? now - 7
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? BARS - 1
                  : null;
    if (target === null) return;
    event.preventDefault();
    choose(target, "later");
  };
  const grow = !prefersReducedMotion();

  return (
    <StickyBar label={title}>
      <div className="grid gap-0">
        <div className="fr-sh">
          <span className="min-w-0">{t("flight.stripHint")}</span>
          <button
            type="button"
            className="fr-jump fr-hit shrink-0"
            onClick={() => {
              if (lowestIndex >= 0 && lowestIndex !== index) choose(lowestIndex, "now");
            }}
          >
            <span>{t("flight.stripJump")}</span>
            <b>{formatAmount(low, currency)}</b>
          </button>
        </div>
        <div
          role="slider"
          tabIndex={0}
          aria-label={t("flight.stripSlider")}
          aria-valuemin={0}
          aria-valuemax={BARS - 1}
          aria-valuenow={index}
          aria-valuetext={valueText}
          className="price-strip"
          style={{ "--x": `${String(((index + 0.5) / BARS) * 100)}%` } as CSSProperties}
          onKeyDown={onKeyDown}
          onPointerDown={(event) => {
            dragging.current = true;
            // jsdom has no pointer capture; a real browser keeps the drag when the finger leaves.
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              /* no capture available: the drag still follows the bars it crosses */
            }
            move(event, "never");
          }}
          onPointerMove={(event) => {
            if (dragging.current) move(event, "never");
          }}
          onPointerUp={() => {
            if (!dragging.current) return;
            dragging.current = false;
            setWave(null);
            commit();
          }}
          onPointerCancel={() => {
            dragging.current = false;
            setWave(null);
            commit();
          }}
        >
          {dates.map((date, i) => {
            const price = prices[i];
            const kind = kindOf(price);
            return (
              <i
                key={date}
                aria-hidden="true"
                data-kind={kind}
                data-selected={i === index ? "true" : undefined}
                data-return={i === returnIndex ? "true" : undefined}
                className={`strip-bar ${grow ? "strip-grow" : ""}`}
                style={
                  {
                    "--i": i,
                    "--h":
                      price === undefined ? EMPTY_PX : 8 + ((price - low) / (high - low || 1)) * 52,
                    ...(wave === null
                      ? {}
                      : { "--w": (1 + 0.2 * Math.exp(-((i - wave) ** 2) / 3.5)).toFixed(3) }),
                  } as CSSProperties
                }
              />
            );
          })}
          <span
            aria-hidden="true"
            className="strip-range"
            style={{
              left: `${String((index / BARS) * 100)}%`,
              width: `${String(((Math.max(spanEnd, index) - index + 1) / BARS) * 100)}%`,
            }}
          />
          <span aria-hidden="true" data-part="tip" className="strip-tip">
            {tipText}
            {delta !== 0 && (
              <em data-direction={delta < 0 ? "down" : "up"} className="strip-delta">
                {plainAmount(Math.abs(delta), currency)}
              </em>
            )}
          </span>
        </div>
        <div aria-hidden="true" className="fr-ax">
          <span>{shortDate(dates[0] ?? searched)}</span>
          <span>{shortDate(dates[BARS - 1] ?? searched)}</span>
        </div>
        <p className="fr-lg">
          {(
            [
              ["cheap", "flight.stripLegendCheap"],
              ["normal", "flight.stripLegendNormal"],
              ["pricey", "flight.stripLegendPricey"],
              ["yours", "flight.stripLegendYours"],
            ] as const
          ).map(([kind, key]) => (
            <span key={kind}>
              <i aria-hidden="true" className={`strip-swatch strip-swatch-${kind}`} />
              {t(key)}
            </span>
          ))}
        </p>
        <p className="fr-lg" data-testid="strip-note">
          {oldestHours >= OLD_AFTER_HOURS && (
            <span className="font-semibold">
              {t("flight.stripAge", { hours: String(oldestHours) })}
            </span>
          )}{" "}
          {t("flight.stripNote")}
        </p>
      </div>
    </StickyBar>
  );
}
