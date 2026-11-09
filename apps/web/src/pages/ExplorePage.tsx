import {
  defaultFlightIntent,
  formatAmount,
  intentToQuery,
  type FlightCard,
  type FlightSearchIntent,
  type FlightSearchReply,
} from "@split/shared";
import { useQuery } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useAuth } from "../auth/AuthProvider.js";
import { DateTiles, cardsOnDate, dateTiles } from "../flights/DateTiles.js";
import { friendlyRange } from "../flights/dates.js";
import { TravelHeader } from "../flights/RouteCard.js";
import { useHighlights } from "../flights/use-highlights.js";
import { readWithRev } from "../groups/data.js";
import { failureMessage, secondaryButton, travelButton } from "../groups/ui.js";
import { t } from "../i18n/messages.js";
import { airportName } from "../flights/AirportPicker.js";

/** The cheapest direct fare from 台北 among today's confirmed ones, if any (highlights span every origin). */
const lowestDirect = (cards: readonly FlightCard[]): FlightCard | undefined =>
  cards
    .filter((c) => c.stops === 0 && c.intent.origin === "TPE")
    .sort((a, b) => a.price - b.price)[0];

/** A bundled illustration, so the hero never depends on a remote image. */
function HeroArt() {
  return (
    <svg
      viewBox="0 0 360 160"
      role="img"
      aria-label={t("explore.heroAlt")}
      preserveAspectRatio="xMidYMid slice"
      className="block h-40 w-full"
    >
      <rect width="360" height="160" fill="#e4f9e9" />
      <circle cx="285" cy="42" r="20" fill="#f6fff8" />
      <path d="M0 112q60-26 120-8t110-6 130 10v52H0z" fill="#2e9d71" />
      <path d="M0 132q90-18 180-4t180-6v38H0z" fill="#26684b" />
      <path d="M60 112q22-34 50-8-12-24-34-24-10 6-16 32z" fill="#143f2a" />
      <path
        d="M196 52l60-14 4 6-40 12 24 14-6 4-34-12-26 12-4-6z"
        fill="#fff"
        stroke="#245b41"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Nearby departure dates priced by the existing search, and a link into 航班 for the picked one. */
function DatesSection({ intent }: { intent: FlightSearchIntent }) {
  const { session } = useAuth();
  const [picked, setPicked] = useState<string>();
  const search = useQuery({
    queryKey: ["flights", "explore-dates", intent],
    queryFn: ({ signal }) =>
      readWithRev<FlightSearchReply>(
        session.fetch("/api/v1/flights/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(intent),
          signal,
        }),
      ),
  });
  const reply = search.data;
  const tiles = dateTiles(reply, picked);
  const cards = cardsOnDate(reply?.cards ?? [], tiles?.selected).sort((a, b) => a.price - b.price);
  const cheapest = cards[0];
  return (
    <div className="mb-4" aria-busy={search.isPending}>
      {search.isPending && (
        <div role="status" className="mt-6 grid gap-2">
          <span className="sr-only">{t("explore.datesLoading")}</span>
          <span className="h-[104px] rounded-[18px] bg-sprout-100 motion-safe:animate-pulse" />
        </div>
      )}
      {(search.isError || reply?.degraded) && (
        <div role="alert" className="mt-6 grid justify-items-start gap-3">
          <p className="text-sm text-red-700">
            {search.isError ? failureMessage(search.error) : t("flight.degraded")}
          </p>
          <button
            type="button"
            className={`${secondaryButton} min-h-11`}
            onClick={() => {
              void search.refetch();
            }}
          >
            {t("common.retry")}
          </button>
        </div>
      )}
      {search.isSuccess && !cheapest && !reply?.degraded && (
        <p className="mt-6 text-sm text-ink-muted">{t("explore.datesEmpty")}</p>
      )}
      {tiles && <DateTiles tiles={tiles} onSelect={setPicked} />}
      {cheapest && (
        <Link
          to={{ pathname: "/travel/flights", search: intentToQuery(cheapest.intent) }}
          className={`${travelButton} mt-3 min-h-12 flex-wrap justify-between gap-x-3 px-5 py-3`}
        >
          <span>{t("explore.cta", { count: String(cards.length) })}</span>
          <span className="tabular-nums">
            {t("explore.ctaFrom", {
              amount: formatAmount(cheapest.price, cheapest.intent.currency),
            })}
          </span>
        </Link>
      )}
    </div>
  );
}

export function ExplorePage() {
  const { state } = useAuth();
  const currency = state.status === "signedIn" ? state.user.preferredCurrency : "TWD";
  const highlights = useHighlights(currency);
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState("");
  const best = lowestDirect(highlights.data?.highlights ?? []);
  const intent = best?.intent ?? defaultFlightIntent(Date.now(), currency);

  return (
    <>
      <TravelHeader intent={intent} />
      <section
        aria-label={t("explore.hero")}
        className="mb-4 overflow-hidden rounded-3xl border border-sprout-200 bg-white"
      >
        <HeroArt />
        <div className="grid gap-1 p-4" aria-busy={highlights.isPending}>
          {highlights.isPending && (
            <div role="status" className="grid gap-2">
              <span className="sr-only">{t("explore.loading")}</span>
              <span className="h-4 w-1/2 rounded bg-sprout-100 motion-safe:animate-pulse" />
              <span className="h-9 w-2/3 rounded bg-sprout-100 motion-safe:animate-pulse" />
            </div>
          )}
          {highlights.isError && (
            <div role="alert" className="grid justify-items-start gap-3">
              <p className="text-sm text-red-700">{failureMessage(highlights.error)}</p>
              <button
                type="button"
                className={`${secondaryButton} min-h-11`}
                onClick={() => {
                  void highlights.refetch();
                }}
              >
                {t("common.retry")}
              </button>
            </div>
          )}
          {highlights.isSuccess && !best && (
            <p className="text-sm text-ink-muted">{t("explore.empty")}</p>
          )}
          {best && (
            <>
              <p className="min-w-0 text-[15px] font-medium break-words text-ink-muted">
                {best.intent.origin} → {best.intent.destination}・
                {friendlyRange(best.intent.departureDate, best.intent.returnDate)}
              </p>
              <p className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-[#f0c978] bg-[#fdf0d5] px-3 py-1 text-sm font-bold text-[#6b3f00]">
                  {t("flight.tileLowest")}
                </span>
                <span className="text-[32px] leading-none font-black text-sprout-900">
                  {formatAmount(best.price, best.intent.currency)}
                </span>
              </p>
              <p className="text-sm text-ink-muted">
                {airportName(best.intent.destination)}・{t("explore.fareNote")}
              </p>
            </>
          )}
        </div>
      </section>
      {best && <DatesSection key={JSON.stringify(best.intent)} intent={best.intent} />}
      <section
        aria-label={t("explore.askTitle")}
        className="mb-6 rounded-3xl border border-sprout-200 bg-sprout-100 p-4"
      >
        <h2 className="font-bold">{t("explore.askTitle")}</h2>
        <p className="mb-3 text-sm text-ink-muted">{t("explore.askHint")}</p>
        <form
          className="flex items-center gap-2 rounded-full border border-sprout-200 bg-white p-1.5 pl-4 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-sprout-700"
          onSubmit={(event) => {
            event.preventDefault();
            if (prompt.trim())
              void navigate("/travel/flights", { state: { prompt: prompt.trim() } });
          }}
        >
          <label className="min-w-0 flex-1">
            <span className="sr-only">{t("flight.prompt")}</span>
            <input
              className="min-h-11 w-full bg-transparent py-2 outline-none placeholder:text-ink-muted"
              value={prompt}
              onChange={(event) => {
                setPrompt(event.target.value);
              }}
              placeholder={t("flight.prompt")}
              maxLength={1000}
            />
          </label>
          <button type="submit" className={`${travelButton} min-h-11 shrink-0 gap-1.5 px-4 py-2`}>
            <Send aria-hidden="true" className="size-4" />
            {t("explore.ask")}
          </button>
        </form>
      </section>
    </>
  );
}
