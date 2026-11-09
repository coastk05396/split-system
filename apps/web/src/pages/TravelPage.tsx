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
import { FLIGHT_SEARCH_FORM_ID, FlightSearchForm } from "../flights/FlightSearchForm.js";
import { STICKY_BAR_SLOT, StickyBar } from "../flights/StickyBar.js";
import { EntityPills } from "../flights/EntityPills.js";
import { RouteCard, TravelHeader } from "../flights/RouteCard.js";
import { addDays, friendlyDate } from "../flights/dates.js";
import {
  DEFAULT_SORT,
  FareResults,
  type FareSort,
  type SavedWatch,
} from "../flights/FareResults.js";
import { findPlace } from "../flights/place.js";
import { PriceStrip } from "../flights/PriceStrip.js";
import { FareTicker } from "../flights/FareTicker.js";
import { readLastSearch, writeLastSearch } from "../flights/last-search.js";
import { useAuth } from "../auth/AuthProvider.js";
import { readWithRev } from "../groups/data.js";
import { failureMessage, travelButton } from "../groups/ui.js";
import { getLocale, t } from "../i18n/messages.js";
import { prefersReducedMotion } from "../shell/motion.js";

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
  const stateOf = useLocation().state as { prompt?: unknown } | null;
  const handedPrompt = useRef(typeof stateOf?.prompt === "string" ? stateOf.prompt : "");
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
    if (intent)
      runIntent(intent); // once, on arrival
    else if (handedPrompt.current) {
      // 探索 hands its 小芽 prompt over in the history state; a refresh must not repeat it.
      const prompt = handedPrompt.current;
      handedPrompt.current = ""; // StrictMode replays this effect
      search.mutate({ prompt, defaults: active });
      void navigate(".", { replace: true, state: null });
    }
    if (intent && Number.isInteger(fare) && fare > 0) setPendingWatch({ intent, fare });
  }, []);

  const reply = search.data;
  const searched = search.isPending || reply !== undefined;
  const resultsTop = useRef<HTMLDivElement>(null);
  const placedAt = useRef(0);
  // Scroll the results to the top of the screen, past it by as much as it takes for the fare
  // carousel to end above a sticky bar (the Price Strip dock can be tall), never so far that the
  // carousel's own top leaves the screen. Reduced motion jumps instead of gliding.
  const placeResults = (behavior: ScrollBehavior) => {
    const results = resultsTop.current;
    if (!results) return;
    const dock = document.querySelector("[data-sticky-bar]")?.getBoundingClientRect();
    const carousel = results.querySelector(".car-wrap")?.getBoundingClientRect();
    const top = results.getBoundingClientRect().top;
    // Scroll by enough that the carousel clears the bar, but keep its top on screen. Measured from
    // where things are now (before the bar appeared the page may not have scrolled as far as
    // wanted); 16 px is the plain gap above the results.
    let margin = 16;
    if (dock && carousel)
      margin = Math.min(16, top - Math.min(carousel.bottom - dock.top + 8, carousel.top - 8));
    results.style.scrollMarginTop = `${String(margin)}px`;
    results.scrollIntoView({ behavior, block: "start" });
  };
  // A finished search scrolls to its results. The advice and the dock arrive a moment later and
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
      <FareTicker
        intent={active}
        onPick={(destination) => {
          const { theme: _theme, ...rest } = active;
          setActive({ ...rest, destination });
        }}
      />
      <div className="fr-in">
        <TravelHeader intent={active} globe={{ code: globe }} />
        <form
          className="fr-ask"
          onSubmit={(event) => {
            event.preventDefault();
            const prompt = new FormData(event.currentTarget).get("prompt");
            if (typeof prompt === "string" && prompt.trim())
              search.mutate({ prompt: prompt.trim(), defaults: active });
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4.5 4.5" />
          </svg>
          <label className="fr-hit">
            <span className="sr-only">{t("flight.prompt")}</span>
            <input name="prompt" placeholder={t("flight.prompt")} required maxLength={1000} />
          </label>
          <button
            type="submit"
            disabled={search.isPending}
            aria-label={t("flight.explore")}
            className="fr-askgo fr-hit"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12h14m-5-5 5 5-5 5" />
            </svg>
          </button>
        </form>
        <RouteCard
          intent={active}
          pending={search.isPending}
          open={panelOpen}
          onToggle={() => {
            setPanelOpen((open) => !open);
          }}
          onSearch={() => {
            runIntent(active);
          }}
          sort={sort}
          onSort={(key) => {
            // A second tap on the active button reverses it; a new button starts ascending.
            setSort((s) => ({ key, descending: s.key === key && !s.descending }));
          }}
        />
        <EntityPills
          intent={active}
          pending={search.isPending}
          open={panelOpen}
          onToggle={() => {
            setPanelOpen((open) => !open);
          }}
          onChange={runIntent}
        />
        {showLastSearch && <p className="text-ink-muted">{t("flight.lastSearch")}</p>}
        {panelOpen && (
          <FlightSearchForm
            intent={active}
            revision={revision}
            pending={search.isPending}
            onSearch={runIntent}
            onPlace={(input) => {
              setGlobe((g) => findPlace(input) ?? g);
            }}
          />
        )}
        {!panelOpen && (
          <PriceStrip
            intent={active}
            onPick={(date) => {
              // A day picked on the strip is a live search that keeps the stay and drops any theme.
              const { theme: _theme, ...rest } = active;
              const nights = active.returnDate
                ? Math.round(
                    (Date.parse(active.returnDate) - Date.parse(active.departureDate)) / 86_400_000,
                  )
                : 0;
              runIntent({
                ...rest,
                departureDate: date,
                ...(active.returnDate ? { returnDate: addDays(date, nights) } : {}),
              });
            }}
          />
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
        <div ref={resultsTop} className="grid scroll-mt-4 gap-3.5">
          {reply && advise.data && (
            <section aria-label={t("flight.advice")} className="mt-3 grid gap-3">
              <p className="px-1">{firstSentence(advise.data.commentary)}</p>
            </section>
          )}
          <FareResults
            pending={search.isPending}
            reply={reply}
            sort={sort}
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
        {searched && highlightsSection}
        {/* Last in the page flow before the bar, whose spacer must be the final element. */}
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
        {panelOpen && (
          <StickyBar>
            <button
              type="submit"
              form={FLIGHT_SEARCH_FORM_ID}
              disabled={search.isPending}
              className="fr-cta shine"
            >
              {t("flight.search")}
            </button>
          </StickyBar>
        )}
        {/* The very last element: the sticky bars' spacer renders in here. */}
        <div id={STICKY_BAR_SLOT} />
      </div>
    </div>
  );
}
