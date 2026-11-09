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
} from "@split/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import * as Dialog from "@radix-ui/react-dialog";
import { FLIGHT_SEARCH_FORM_ID, FlightSearchForm } from "../flights/FlightSearchForm.js";
import { RouteCard, TravelHeader } from "../flights/RouteCard.js";
import { friendlyDate } from "../flights/dates.js";
import {
  DEFAULT_SORT,
  FareResults,
  type FareSort,
  type SavedWatch,
} from "../flights/FareResults.js";
import { findPlace } from "../flights/place.js";
import { readLastSearch, writeLastSearch } from "../flights/last-search.js";
import { useAuth } from "../auth/AuthProvider.js";
import { readWithRev } from "../groups/data.js";
import { failureMessage, travelButton } from "../groups/ui.js";
import { getLocale, t } from "../i18n/messages.js";
import { prefersReducedMotion } from "../shell/motion.js";
import type { SearchKeyHandover } from "../shell/SearchKey.js";

import { useHighlights } from "../flights/use-highlights.js";
import { FlightPriceWatches, useCreateWatch } from "../flights/FlightPriceWatches.js";

/** The advice is one short sentence on screen; the rest of the grounded commentary is dropped. */
const firstSentence = (text: string) => /^.*?(?:[。！？]|[.!?](?=\s|$))/s.exec(text)?.[0] ?? text;

export function TravelPage() {
  const [watchCard, setWatchCard] = useState<FlightCard | null>(null);
  const [savedWatch, setSavedWatch] = useState<SavedWatch | null>(null);
  const { state, session } = useAuth();
  const currency = state.status === "signedIn" ? state.user.preferredCurrency : "TWD";
  // A LINE portal link carries its own search; otherwise the last search is restored, never run.
  const [params] = useSearchParams();
  const [lastSearch] = useState(() => (intentFromQuery(params) ? null : readLastSearch()));
  const [showLastSearch, setShowLastSearch] = useState(lastSearch !== null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [sort, setSort] = useState<FareSort>(DEFAULT_SORT);
  // Why the sheet opened without the microphone (the Search key could not record).
  const [micHint, setMicHint] = useState(false);
  const [active, setIntent] = useState(
    () => lastSearch ?? defaultFlightIntent(Date.now(), currency),
  );
  // Bumped on every search so the fields reset to what was searched even when the intent is equal.
  const [revision, setRevision] = useState(0);
  // The globe faces the last place it recognised; unknown input never moves it.
  const [globe, setGlobe] = useState(() => findPlace(active.destination));
  const setActive = (intent: FlightSearchIntent) => {
    setIntent(intent);
    setGlobe((g) => findPlace(intent.destination) ?? g);
    setRevision((r) => r + 1);
  };
  const highlights = useHighlights(currency);
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
  // Only the newest search may apply its reply: an older one that answers late is dropped.
  const latestSearch = useRef(0);
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
      latestSearch.current += 1;
      advise.reset();
      setPanelOpen(false);
      setMicHint(false);
      setShowLastSearch(false);
      return { id: latestSearch.current };
    },
    onSuccess: (reply, _request, started) => {
      if (started.id !== latestSearch.current) return;
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
  const navigate = useNavigate();
  const location = useLocation();
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

  // The Search key hands over what the User did (tap, or spoke) in the history state; it is used
  // once and cleared, so a refresh never repeats it.
  const handled = useRef<string | null>(null);
  useEffect(() => {
    const handover = location.state as SearchKeyHandover | null;
    if (!handover || handled.current === location.key) return;
    handled.current = location.key; // StrictMode replays this effect
    if (typeof handover.prompt === "string" && handover.prompt)
      search.mutate({ prompt: handover.prompt, defaults: active });
    else if (handover.sheet) {
      setPanelOpen(true);
      setMicHint(handover.micHint === true);
    }
    void navigate(".", { replace: true, state: null });
  }, [location.key]);

  const reply = search.data;
  const resultsTop = useRef<HTMLDivElement>(null);
  const placedAt = useRef(0);
  // Scroll the results to the top of the screen. Reduced motion jumps instead of gliding.
  const placeResults = (behavior: ScrollBehavior) => {
    const results = resultsTop.current;
    if (!results) return;
    results.style.scrollMarginTop = "16px";
    results.scrollIntoView({ behavior, block: "start" });
  };
  // A finished search scrolls to its results. The advice arrives a moment later and
  // move things, so for 3 s after the search the placement is repeated whenever the page resizes.
  useEffect(() => {
    if (!reply) return;
    placedAt.current = Date.now();
    placeResults(prefersReducedMotion() ? "auto" : "smooth");
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (Date.now() - placedAt.current < 3000) placeResults("auto");
    });
    observer.observe(document.body);
    const stop = setTimeout(() => {
      observer.disconnect();
    }, 3000);
    return () => {
      clearTimeout(stop);
      observer.disconnect();
    };
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
  return (
    <div className="fr-page">
      <div className="fr-in">
        <TravelHeader intent={active} globe={{ code: globe }} />
        <RouteCard
          intent={active}
          pending={search.isPending}
          onOpen={() => {
            setPanelOpen(true);
          }}
        />
        {showLastSearch && <p className="sr-only">{t("flight.lastSearch")}</p>}
        {!reply && !search.isPending && !search.isError && (
          <p className="fr-hintcard">{t("flight.voiceHint")}</p>
        )}
        <Dialog.Root modal={false} open={panelOpen} onOpenChange={setPanelOpen}>
          <Dialog.Portal>
            <div className="fr-sheet-dim" aria-hidden="true" />
            <Dialog.Content
              aria-describedby={undefined}
              className="fr-sheet"
              onEscapeKeyDown={(event) => {
                // Escape belongs to an open airport list or passengers sheet first.
                if (document.querySelector('[role="listbox"], [aria-modal="true"]'))
                  event.preventDefault();
              }}
            >
              <Dialog.Title className="sr-only">{t("flight.sheet")}</Dialog.Title>
              <div className="fr-sheet-grip" aria-hidden="true" />
              <FlightSearchForm
                intent={active}
                revision={revision}
                pending={search.isPending}
                onSearch={runIntent}
                onPlace={(input) => {
                  setGlobe((g) => findPlace(input) ?? g);
                }}
                hint={micHint ? t("voice.micHint") : undefined}
                more={highlightsSection}
              />
              <div className="fr-sheet-cta">
                <button
                  type="submit"
                  form={FLIGHT_SEARCH_FORM_ID}
                  disabled={search.isPending}
                  className="fr-cta shine"
                >
                  {t("flight.search")}
                </button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
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
              className={`${travelButton} px-6 py-4`}
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
        <div ref={resultsTop} className="mt-3.5 grid scroll-mt-4 gap-3.5">
          {reply && advise.data && (
            <section aria-label={t("flight.advice")} className="contents">
              <p className="sr-only">{firstSentence(advise.data.commentary)}</p>
            </section>
          )}
          <FareResults
            pending={search.isPending}
            reply={reply}
            route={search.variables && "prompt" in search.variables ? undefined : active}
            sort={sort}
            onSort={(key) => {
              // A second tap on the active button reverses it; a new button starts ascending.
              setSort((s) => ({ key, descending: s.key === key && !s.descending }));
            }}
            onWatch={setWatchCard}
            saved={savedWatch}
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
        <FlightPriceWatches
          card={watchCard}
          onClose={() => {
            setWatchCard(null);
          }}
          onSaved={(card) => {
            // A running count, so saving the same fare twice is always a new identity.
            setSavedWatch((previous) => ({ card, at: (previous?.at ?? 0) + 1 }));
          }}
        />
      </div>
    </div>
  );
}
