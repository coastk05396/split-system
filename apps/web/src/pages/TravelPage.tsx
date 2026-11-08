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
import { friendlyDate } from "../flights/dates.js";
import { FareResults } from "../flights/FareResults.js";
import { PriceStrip, priceStrip } from "../flights/PriceStrip.js";
import { RouteGlobe, RouteLeg } from "../flights/RouteGlobe.js";
import { readLastSearch, writeLastSearch } from "../flights/last-search.js";
import { useAuth } from "../auth/AuthProvider.js";
import { readWithRev } from "../groups/data.js";
import { ScreenHeader, failureMessage, primaryButton } from "../groups/ui.js";
import { getLocale, t } from "../i18n/messages.js";
import { prefersReducedMotion } from "../shell/motion.js";

import { FlightPriceWatches, useCreateWatch } from "../flights/FlightPriceWatches.js";

/** The advice is one short sentence on screen; the rest of the grounded commentary is dropped. */
const firstSentence = (text: string) => /^.*?(?:[。！？]|[.!?](?=\s|$))/s.exec(text)?.[0] ?? text;

export function TravelPage() {
  const [watchCard, setWatchCard] = useState<FlightCard | null>(null);
  const { state, session } = useAuth();
  const currency = state.status === "signedIn" ? state.user.preferredCurrency : "TWD";
  // A LINE portal link carries its own search; otherwise the last search is restored, never run.
  const [params] = useSearchParams();
  const [lastSearch] = useState(() => (intentFromQuery(params) ? null : readLastSearch()));
  const [showLastSearch, setShowLastSearch] = useState(lastSearch !== null);
  const [panelOpen, setPanelOpen] = useState(false);
  // The date picked on the strip belongs to the reply it was picked on; the legend is first-touch.
  const [picked, setPicked] = useState<{ reply: FlightSearchReply; date: string } | null>(null);
  const [stripTouched, setStripTouched] = useState(false);
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
  const searched = search.isPending || reply !== undefined;
  const resultsTop = useRef<HTMLDivElement>(null);
  // A finished search scrolls to its results; reduced motion jumps instead of gliding.
  useEffect(() => {
    if (reply)
      resultsTop.current?.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "start",
      });
  }, [reply]);
  const highlightsSection = (
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
                {formatAmount(card.price, card.intent.currency)} ·{" "}
                {friendlyDate(card.intent.departureDate)}
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
  );
  const strip = priceStrip(reply, picked?.reply === reply ? picked?.date : undefined);
  return (
    <>
      <ScreenHeader
        title={t("flight.title")}
        action={<RouteGlobe origin={active.origin} destination={active.destination} />}
        subtitle={<RouteLeg origin={active.origin} destination={active.destination} />}
      />
      <form
        className="glass-chip mb-4 flex items-center gap-2 rounded-full border border-sprout-200 p-1.5 pl-4 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-sprout-700"
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
            className="min-h-11 w-full bg-transparent py-2 outline-none placeholder:text-ink-muted"
            name="prompt"
            placeholder={t("flight.prompt")}
            required
            maxLength={1000}
          />
        </label>
        <button
          type="submit"
          disabled={search.isPending}
          className="press-pill min-h-11 rounded-full bg-sprout-500 px-4 py-2 font-bold text-white focus-visible:outline-2 focus-visible:outline-sprout-700 disabled:opacity-60"
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
      {!searched && highlightsSection}
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
      {/* After a search the results come first, right under the summary; the page scrolls here. */}
      <div ref={resultsTop} className="scroll-mt-4">
        {!panelOpen && reply && strip && (
          <section
            aria-label={t("flight.priceStrip")}
            className="surface-card mt-6 rounded-3xl border border-sprout-200 bg-white p-4"
          >
            <PriceStrip
              strip={strip}
              touched={stripTouched}
              onTouch={() => {
                setStripTouched(true);
              }}
              onSelect={(date) => {
                setPicked({ reply, date });
              }}
            />
          </section>
        )}
        {reply && advise.data && (
          <section aria-label={t("flight.advice")} className="mt-3 grid gap-3">
            <p className="px-1">{firstSentence(advise.data.commentary)}</p>
          </section>
        )}
        <FareResults
          pending={search.isPending}
          reply={reply}
          date={strip?.selected}
          onWatch={setWatchCard}
        />
      </div>
      {reply && advise.data && (
        <section aria-label={t("flight.ideas")} className="mt-4">
          <div className="flex flex-wrap gap-2">
            {advise.data.moves.map((move) => (
              <button
                key={move.id}
                type="button"
                disabled={search.isPending}
                className="press-pill min-h-11 rounded-full border border-sprout-200 bg-sprout-50 px-4 py-2 text-sm font-bold focus-visible:outline-2 focus-visible:outline-sprout-700"
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
      {searched && highlightsSection}
      {/* Last in the page flow before the bar, whose spacer must be the final element. */}
      <FlightPriceWatches
        card={watchCard}
        onClose={() => {
          setWatchCard(null);
        }}
      />
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
    </>
  );
}
