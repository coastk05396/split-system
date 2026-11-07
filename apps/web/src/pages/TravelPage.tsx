import {
  applyIntentPatch,
  defaultFlightIntent,
  formatAmount,
  intentFromQuery,
  type FlightAdviceReply,
  type FlightAdviceRequest,
  type FlightCard,
  type FlightSearchIntent,
  type FlightSearchRequest,
  type FlightSearchReply,
  type FlightHighlightsReply,
} from "@split/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { FLIGHT_SEARCH_FORM_ID, FlightSearchForm } from "../flights/FlightSearchForm.js";
import { StickyBar } from "../flights/StickyBar.js";
import { EntityPills } from "../flights/EntityPills.js";
import { readLastSearch, writeLastSearch } from "../flights/last-search.js";
import { useAuth } from "../auth/AuthProvider.js";
import { readWithRev } from "../groups/data.js";
import { ScreenHeader, failureMessage, primaryButton } from "../groups/ui.js";
import { getLocale, t } from "../i18n/messages.js";

import {
  FlightPriceWatchButton,
  FlightPriceWatches,
  useCreateWatch,
} from "../flights/FlightPriceWatches.js";

export function TravelPage() {
  const [watchCard, setWatchCard] = useState<FlightCard | null>(null);
  const { state, session } = useAuth();
  const currency = state.status === "signedIn" ? state.user.preferredCurrency : "TWD";
  // A LINE portal link carries its own search; otherwise the last search is restored, never run.
  const [params] = useSearchParams();
  const [lastSearch] = useState(() => (intentFromQuery(params) ? null : readLastSearch()));
  const [showLastSearch, setShowLastSearch] = useState(lastSearch !== null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [active, setIntent] = useState(
    () => lastSearch ?? defaultFlightIntent(Date.now(), currency),
  );
  // Bumped on every search so the fields reset to what was searched even when the intent is equal.
  const [revision, setRevision] = useState(0);
  const setActive = (intent: FlightSearchIntent) => {
    setIntent(intent);
    setRevision((r) => r + 1);
  };
  const highlights = useQuery({
    queryKey: ["flights", "highlights", currency],
    queryFn: ({ signal }) =>
      readWithRev<FlightHighlightsReply>(
        session.fetch(`/api/v1/flights/highlights?currency=${currency}`, { signal }),
      ),
  });
  // Advice is progressive: cards render from the search reply, and this never blocks or errors them.
  const advise = useMutation({
    mutationFn: (request: FlightAdviceRequest) =>
      readWithRev<FlightAdviceReply>(
        session.fetch("/api/v1/flights/advise", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        }),
      ),
  });
  const search = useMutation({
    mutationFn: (intent: FlightSearchRequest) =>
      readWithRev<FlightSearchReply>(
        session.fetch("/api/v1/flights/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(intent),
        }),
      ),
    onMutate: () => {
      advise.reset();
      setPanelOpen(false);
      setShowLastSearch(false);
    },
    onSuccess: (reply) => {
      setActive(reply.intent);
      writeLastSearch(reply.intent);
      if (reply.cards.length)
        advise.mutate({ language: getLocale(), intent: reply.intent, cards: reply.cards });
    },
  });
  function runIntent(intent: FlightSearchIntent) {
    setActive(intent);
    search.mutate(intent);
  }

  // The LINE portal bubble opens /travel with its search in the query: run it once, no parse.
  const portalIntent = useRef(intentFromQuery(params));
  // A LINE chat tap by someone not yet signed up adds `watch=line&fare=`; the User confirms it below.
  const pendingFare = useRef(params.get("watch") === "line" ? Number(params.get("fare")) : 0);
  const [pendingWatch, setPendingWatch] = useState<{
    intent: FlightSearchIntent;
    fare: number;
  } | null>(null);
  const queryClient = useQueryClient();
  const createWatch = useCreateWatch();
  const lineWatch = useMutation({
    mutationFn: (pending: { intent: FlightSearchIntent; fare: number }) =>
      createWatch({
        intent: pending.intent,
        baselineFare: pending.fare,
        targetFare: Math.max(1, Math.floor(pending.fare * 0.85)),
        channel: "line_push",
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["flights", "watches"] }),
  });
  useEffect(() => {
    const intent = portalIntent.current;
    const fare = pendingFare.current;
    portalIntent.current = null;
    pendingFare.current = 0;
    if (intent) runIntent(intent); // once, on arrival
    if (intent && Number.isInteger(fare) && fare > 0) setPendingWatch({ intent, fare });
  }, []);

  const reply = search.data;
  return (
    <>
      <ScreenHeader title={t("flight.title")} subtitle={t("flight.subtitle")} />
      <form
        className="glass-chip mb-4 flex items-center gap-2 rounded-full border border-sprout-200 p-1.5 pl-4"
        onSubmit={(event) => {
          event.preventDefault();
          const prompt = new FormData(event.currentTarget).get("prompt");
          if (typeof prompt === "string" && prompt.trim())
            search.mutate({ prompt: prompt.trim(), defaults: active });
        }}
      >
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t("flight.prompt")}</span>
          <input
            className="w-full bg-transparent py-2 outline-none placeholder:text-ink-muted"
            name="prompt"
            placeholder={t("flight.prompt")}
            required
            maxLength={1000}
          />
        </label>
        <button
          type="submit"
          disabled={search.isPending}
          className="press-pill rounded-full bg-sprout-500 px-4 py-2 font-bold text-white focus-visible:outline-2 focus-visible:outline-sprout-700 disabled:opacity-60"
        >
          {t("flight.explore")}
        </button>
      </form>
      <EntityPills
        intent={active}
        pending={search.isPending}
        open={panelOpen}
        onToggle={() => {
          setPanelOpen((open) => !open);
        }}
        onChange={runIntent}
      />
      {showLastSearch && <p className="mt-2 text-sm text-ink-muted">{t("flight.lastSearch")}</p>}
      {panelOpen && (
        <div className="mt-3">
          <FlightSearchForm
            intent={active}
            revision={revision}
            pending={search.isPending}
            onSearch={runIntent}
          />
        </div>
      )}
      <section aria-label={t("flight.highlights")} className="my-6">
        <h2 className="mb-3 font-bold">{t("flight.highlights")}</h2>
        {highlights.data?.highlights.length ? (
          <div className="flex gap-3 overflow-x-auto pb-2">
            {highlights.data.highlights.map((card) => (
              <button
                key={card.url}
                type="button"
                onClick={() => {
                  runIntent(card.intent);
                }}
                className="press-pill shrink-0 rounded-2xl border border-sprout-200 bg-sprout-50 px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-sprout-700"
              >
                <span className="block font-bold">
                  {card.intent.origin} → {card.intent.destination}
                </span>
                <span className="text-sm">
                  {formatAmount(card.price, card.intent.currency)} · {card.intent.departureDate}
                </span>
              </button>
            ))}
          </div>
        ) : (
          !highlights.isPending && (
            <p className="text-sm text-ink-muted">
              {t(highlights.isError ? "flight.highlightsUnavailable" : "flight.noHighlights")}
            </p>
          )
        )}
      </section>
      {pendingWatch && !lineWatch.isSuccess && (
        <section aria-label={t("flight.lineWatchConfirm")} className="mt-5 grid gap-3">
          <p>
            {t("flight.lineWatchAsk", {
              route: `${pendingWatch.intent.origin} → ${pendingWatch.intent.destination}`,
              amount: formatAmount(
                Math.max(1, Math.floor(pendingWatch.fare * 0.85)),
                pendingWatch.intent.currency,
              ),
            })}
          </p>
          <button
            type="button"
            disabled={lineWatch.isPending}
            className={primaryButton}
            onClick={() => {
              lineWatch.mutate(pendingWatch);
            }}
          >
            {t("flight.lineWatchConfirm")}
          </button>
        </section>
      )}
      {lineWatch.isSuccess && (
        <p role="status" className="mt-5 font-bold">
          {t("flight.lineWatchSet")}
        </p>
      )}
      {lineWatch.isError && (
        <p role="alert" className="mt-5">
          {failureMessage(lineWatch.error)}
        </p>
      )}
      {search.isError && (
        <p role="alert" className="mt-5 text-sm text-red-700">
          {failureMessage(search.error)}
        </p>
      )}
      {search.isPending && (
        <p role="status" className="mt-5 text-ink-muted">
          {t("flight.searching")}
        </p>
      )}
      {reply && advise.data && (
        <section
          aria-label={t("flight.advice")}
          className="rise surface-card mt-6 grid gap-3 rounded-3xl border border-sprout-200 bg-white p-5"
        >
          <p>{advise.data.commentary}</p>
          <div className="flex flex-wrap gap-2">
            {advise.data.moves.map((move) => (
              <button
                key={move.id}
                type="button"
                disabled={search.isPending}
                className="press-pill rounded-full border border-sprout-200 bg-sprout-50 px-4 py-2 text-sm font-bold focus-visible:outline-2 focus-visible:outline-sprout-700"
                onClick={() => {
                  runIntent(applyIntentPatch(reply.intent, move.patch));
                }}
              >
                {move.label}
              </button>
            ))}
          </div>
        </section>
      )}
      {reply && (
        <section aria-label={t("flight.results")} className="mt-6 grid gap-4 sm:grid-cols-2">
          {(reply.degraded || reply.cards.length === 0) && (
            <div className="surface-card rounded-3xl border border-sprout-200 bg-white p-5 sm:col-span-2">
              <p className="mb-4 text-ink-muted">
                {t(reply.degraded ? "flight.degraded" : "flight.empty")}
              </p>
              <a
                href={reply.url}
                target="_blank"
                rel="noopener noreferrer"
                className={primaryButton}
              >
                {t("flight.view")}
              </a>
            </div>
          )}
          {reply.cards.map((card) => (
            <article
              key={`${card.url}-${card.airline}-${card.outboundDeparture}-${card.price}`}
              className="surface-card flex flex-col gap-3 rounded-3xl border border-sprout-200 bg-white p-5"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-bold">
                  {card.intent.origin} → {card.intent.destination}
                </h2>
                <span className="rounded-full bg-sprout-100 px-3 py-1 text-sm font-bold">
                  {t(`flight.${card.signal}`)}
                </span>
              </div>
              <p className="text-sm text-ink-muted">
                {card.intent.departureDate} – {card.intent.returnDate}
              </p>
              <p className="text-3xl font-bold tabular-nums">
                {formatAmount(card.price, card.intent.currency)}
              </p>
              <p className="font-bold">{card.airline}</p>
              <p className="text-sm">
                {t("flight.outbound")}: {card.outboundDeparture} → {card.outboundArrival}
              </p>
              <p className="text-sm">
                {card.inboundDeparture !== null && card.inboundArrival !== null
                  ? `${t("flight.inbound")}: ${card.inboundDeparture} → ${card.inboundArrival}`
                  : t("flight.returnOnGoogle")}
              </p>
              <p className="text-sm text-ink-muted">
                {t("flight.summary", { stops: card.stops, minutes: card.durationMinutes })}
              </p>
              {card.history && card.history.days >= 14 && (
                <div className="text-sm text-ink-muted">
                  <p>
                    {t(
                      card.history.percentBelowMean >= 0
                        ? "flight.historyBelow"
                        : "flight.historyAbove",
                      { percent: Math.abs(card.history.percentBelowMean), days: card.history.days },
                    )}
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
              <FlightPriceWatchButton card={card} onWatch={setWatchCard} />
            </article>
          ))}
        </section>
      )}
      {panelOpen && (
        <StickyBar>
          <button
            type="submit"
            form={FLIGHT_SEARCH_FORM_ID}
            disabled={search.isPending}
            className={`${primaryButton} w-full`}
          >
            {t("flight.search")}
          </button>
        </StickyBar>
      )}
      <FlightPriceWatches
        card={watchCard}
        onClose={() => {
          setWatchCard(null);
        }}
      />
    </>
  );
}
