import {
  CURRENCIES,
  flightSearchIntentSchema,
  formatAmount,
  parseAmount,
  type FlightCard,
  type FlightSearchIntent,
  type FlightSearchReply,
  type FlightHighlightsReply,
} from "@split/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type SubmitEvent } from "react";
import { useAuth } from "../auth/AuthProvider.js";
import { readWithRev } from "../groups/data.js";
import { ScreenHeader, failureMessage, input, primaryButton } from "../groups/ui.js";
import { errorMessage, t } from "../i18n/messages.js";

import { FlightPriceWatchButton, FlightPriceWatches } from "../flights/FlightPriceWatches.js";

export function TravelPage() {
  const [watchCard, setWatchCard] = useState<FlightCard | null>(null);
  const { state, session } = useAuth();
  const currency = state.status === "signedIn" ? state.user.preferredCurrency : "TWD";
  const [invalid, setInvalid] = useState(false);
  const highlights = useQuery({
    queryKey: ["flights", "highlights", currency],
    queryFn: ({ signal }) =>
      readWithRev<FlightHighlightsReply>(
        session.fetch(`/api/v1/flights/highlights?currency=${currency}`, { signal }),
      ),
  });
  const search = useMutation({
    mutationFn: (intent: FlightSearchIntent) =>
      readWithRev<FlightSearchReply>(
        session.fetch("/api/v1/flights/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(intent),
        }),
      ),
  });

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const budgetValue = form.get("budget");
    const budgetText = typeof budgetValue === "string" ? budgetValue : "";
    const budget = budgetText === "" ? undefined : parseAmount(budgetText, currency);
    if (budget !== undefined && !budget.ok) {
      setInvalid(true);
      return;
    }
    const parsed = flightSearchIntentSchema.safeParse({
      origin: form.get("origin"),
      destination: form.get("destination"),
      departureDate: form.get("departureDate"),
      returnDate: form.get("returnDate"),
      currency,
      budget: budget?.value,
      excludeRedEye: form.has("excludeRedEye"),
      directOnly: form.has("directOnly"),
    });
    setInvalid(!parsed.success);
    if (parsed.success) search.mutate(parsed.data);
  }

  const reply = search.data;
  return (
    <>
      <ScreenHeader title={t("flight.title")} subtitle={t("flight.subtitle")} />
      <section aria-label={t("flight.highlights")} className="mb-6">
        <h2 className="mb-3 font-bold">{t("flight.highlights")}</h2>
        {highlights.data?.highlights.length ? (
          <div className="flex gap-3 overflow-x-auto pb-2">
            {highlights.data.highlights.map((card) => (
              <button
                key={card.url}
                type="button"
                onClick={() => {
                  search.mutate(card.intent);
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
      <form
        onSubmit={submit}
        className="surface-card grid gap-4 rounded-3xl border border-sprout-200 bg-white p-5 sm:grid-cols-2"
        aria-busy={search.isPending}
      >
        <label className="grid gap-1 text-sm font-bold">
          {t("flight.origin")}
          <input
            className={input}
            name="origin"
            defaultValue="TPE"
            list="origin-airports"
            required
            pattern="[A-Z]{3}"
            maxLength={3}
            autoCapitalize="characters"
          />
          <datalist id="origin-airports">
            {["TPE", "TSA", "RMQ", "KHH"].map((code) => (
              <option key={code} value={code} />
            ))}
          </datalist>
        </label>
        <label className="grid gap-1 text-sm font-bold">
          {t("flight.destination")}
          <input
            className={input}
            name="destination"
            required
            pattern="[A-Z]{3}"
            maxLength={3}
            autoCapitalize="characters"
            placeholder="NRT"
          />
        </label>
        <label className="grid gap-1 text-sm font-bold">
          {t("flight.departure")}
          <input className={input} name="departureDate" type="date" required />
        </label>
        <label className="grid gap-1 text-sm font-bold">
          {t("flight.return")}
          <input className={input} name="returnDate" type="date" required />
        </label>
        <label className="grid gap-1 text-sm font-bold">
          {t("flight.budget")} · {currency}
          <input
            className={input}
            name="budget"
            type="number"
            min="1"
            step={10 ** -CURRENCIES[currency].decimals}
          />
        </label>
        <div className="flex flex-col justify-center gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="excludeRedEye" />
            {t("flight.excludes")}
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="directOnly" />
            {t("flight.direct")}
          </label>
        </div>
        {invalid && (
          <p role="alert" className="text-sm text-red-700 sm:col-span-2">
            {errorMessage("VALIDATION_FAILED")}
          </p>
        )}
        {search.isError && (
          <p role="alert" className="text-sm text-red-700 sm:col-span-2">
            {failureMessage(search.error)}
          </p>
        )}
        <button
          type="submit"
          className={`${primaryButton} sm:col-span-2`}
          disabled={search.isPending}
        >
          {t("flight.search")}
        </button>
      </form>
      {search.isPending && (
        <p role="status" className="mt-5 text-ink-muted">
          {t("flight.searching")}
        </p>
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
      <FlightPriceWatches
        card={watchCard}
        onClose={() => {
          setWatchCard(null);
        }}
      />
    </>
  );
}
