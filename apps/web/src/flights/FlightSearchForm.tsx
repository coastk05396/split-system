import {
  CURRENCIES,
  flightSearchIntentSchema,
  parseAmount,
  taiwanDate,
  FLIGHT_THEMES,
  type FlightSearchIntent,
} from "@split/shared";
import { useState, type SubmitEvent } from "react";
import {
  AirportPicker,
  POPULAR_DESTINATIONS,
  POPULAR_ORIGINS,
  rememberAirports,
} from "./AirportPicker.js";
import { input } from "../groups/ui.js";
import { errorMessage, t } from "../i18n/messages.js";
import { DatesCalendar } from "./DatesCalendar.js";
import { PartyPanel, TripToggle, toParty, type Party } from "./PartyPanel.js";

interface Draft {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate: string;
  budget: string;
  theme: string;
  excludeRedEye: boolean;
  directOnly: boolean;
  party: Party;
}

const DAY = 86_400_000;
const threeDaysAfter = (date: string) =>
  new Date(Date.parse(date) + 3 * DAY).toISOString().slice(0, 10);

function toDraft(intent: FlightSearchIntent): Draft {
  return {
    origin: intent.origin,
    destination: intent.destination,
    departureDate: intent.departureDate,
    // A one-way search has no return date: offer a sensible one if the User switches back.
    returnDate: intent.returnDate ?? threeDaysAfter(intent.departureDate),
    budget:
      intent.budget === undefined
        ? ""
        : String(intent.budget / 10 ** CURRENCIES[intent.currency].decimals),
    theme: intent.theme ?? "",
    excludeRedEye: intent.excludeRedEye,
    directOnly: intent.directOnly,
    party: toParty(intent),
  };
}

/** The Search button lives in the sticky bottom bar and submits this form by id. */
export const FLIGHT_SEARCH_FORM_ID = "flight-search-form";

export function FlightSearchForm({
  intent: active,
  revision,
  pending,
  onSearch,
  onPlace,
}: {
  intent: FlightSearchIntent;
  /** Changes whenever a search runs, so the fields redraw even for an identical intent. */
  revision: number;
  pending: boolean;
  onSearch: (intent: FlightSearchIntent) => void;
  /** The destination the User is picking or typing, for the globe. */
  onPlace?: (input: string) => void;
}) {
  const currency = active.currency;
  const [problem, setProblem] = useState<"fields" | "past" | null>(null);
  const today = taiwanDate(Date.now());
  // The fields follow the active intent: a prompt, pill, chip, highlight or portal link redraws them.
  const key = `${revision}${JSON.stringify(active)}`;
  const [seen, setSeen] = useState(key);
  const [draft, setDraft] = useState(() => toDraft(active));
  if (seen !== key) {
    setSeen(key);
    setDraft(toDraft(active));
  }
  const set = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
  };
  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const budget = draft.budget === "" ? undefined : parseAmount(draft.budget, currency);
    if (budget !== undefined && !budget.ok) {
      setProblem("fields");
      return;
    }
    const parsed = flightSearchIntentSchema.safeParse({
      origin: draft.origin,
      destination: draft.destination,
      departureDate: draft.departureDate,
      // Defaults stay absent so a plain search keeps the same intent, cache key and Price Watch as before.
      returnDate: draft.party.oneWay ? undefined : draft.returnDate,
      tripType: draft.party.oneWay ? "one-way" : undefined,
      adults: draft.party.adults === 1 ? undefined : draft.party.adults,
      children: draft.party.children === 0 ? undefined : draft.party.children,
      infants: draft.party.infants === 0 ? undefined : draft.party.infants,
      cabin: draft.party.cabin === "economy" ? undefined : draft.party.cabin,
      currency,
      budget: budget?.value,
      excludeRedEye: draft.excludeRedEye,
      directOnly: draft.directOnly,
      theme: draft.theme || undefined,
    });
    if (!parsed.success) {
      setProblem("fields");
      return;
    }
    if (parsed.data.departureDate < today) {
      setProblem("past");
      return;
    }
    setProblem(null);
    rememberAirports({ origin: parsed.data.origin, destination: parsed.data.destination });
    onSearch(parsed.data);
  }

  return (
    <form
      id={FLIGHT_SEARCH_FORM_ID}
      aria-label={t("flight.editCondition")}
      noValidate
      onSubmit={submit}
      className="fr-card"
      aria-busy={pending}
    >
      <TripToggle
        oneWay={draft.party.oneWay}
        onChange={(oneWay) => {
          setDraft((d) => ({ ...d, party: { ...d.party, oneWay } }));
        }}
      />
      <PartyPanel
        value={draft.party}
        onChange={(patch) => {
          setDraft((d) => ({ ...d, party: { ...d.party, ...patch } }));
        }}
      />
      <div className="fr-route">
        <AirportPicker
          name="origin"
          text={t("flight.origin")}
          value={draft.origin}
          popular={POPULAR_ORIGINS}
          onChange={(origin) => {
            set({ origin });
          }}
        />
        <AirportPicker
          name="destination"
          text={t("flight.destination")}
          value={draft.destination}
          popular={POPULAR_DESTINATIONS}
          popularHeading="flight.airportPopularDest"
          onChange={(destination) => {
            set({ destination });
            onPlace?.(destination);
          }}
          onType={onPlace}
        />
        <button
          type="button"
          aria-label={t("flight.swap")}
          onClick={() => {
            set({ origin: draft.destination, destination: draft.origin });
          }}
          className="fr-swap fr-hit"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" />
          </svg>
        </button>
      </div>
      <div className="fr-perf" aria-hidden="true" />
      <DatesCalendar
        route={{ origin: draft.origin, destination: draft.destination, currency }}
        today={today}
        departure={draft.departureDate}
        returnDate={draft.returnDate}
        oneWay={draft.party.oneWay}
        onChange={set}
      />
      <div className="fr-extra">
        <label className="grid gap-1 text-sm font-bold">
          {t("flight.departure")}
          <input
            className={input}
            name="departureDate"
            min={today}
            value={draft.departureDate}
            onChange={(e) => {
              set({ departureDate: e.target.value });
            }}
            type="date"
            required
          />
        </label>
        {!draft.party.oneWay && (
          <label className="grid gap-1 text-sm font-bold">
            {t("flight.return")}
            <input
              className={input}
              name="returnDate"
              min={draft.departureDate > today ? draft.departureDate : today}
              value={draft.returnDate}
              onChange={(e) => {
                set({ returnDate: e.target.value });
              }}
              type="date"
              required
            />
          </label>
        )}
        <label className="grid gap-1 text-sm font-bold">
          {t("flight.budget")} · {currency}
          <input
            className={input}
            name="budget"
            value={draft.budget}
            onChange={(e) => {
              set({ budget: e.target.value });
            }}
            type="number"
            min="1"
            step={10 ** -CURRENCIES[currency].decimals}
          />
        </label>
        <label className="grid gap-1 text-sm font-bold">
          {t("flight.theme")}
          <select
            name="theme"
            value={draft.theme}
            onChange={(e) => {
              set({ theme: e.target.value });
            }}
            className={input}
          >
            <option value="">{t("flight.theme.none")}</option>
            {FLIGHT_THEMES.map((theme) => (
              <option key={theme} value={theme}>
                {t(`flight.theme.${theme}`)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col justify-center gap-2 text-sm">
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              name="excludeRedEye"
              checked={draft.excludeRedEye}
              onChange={(e) => {
                set({ excludeRedEye: e.target.checked });
              }}
            />
            {t("flight.excludes")}
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              name="directOnly"
              checked={draft.directOnly}
              onChange={(e) => {
                set({ directOnly: e.target.checked });
              }}
            />
            {t("flight.direct")}
          </label>
        </div>
      </div>
      {problem && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {problem === "past" ? t("flight.pastDate") : errorMessage("VALIDATION_FAILED")}
        </p>
      )}
    </form>
  );
}
