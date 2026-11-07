import {
  CURRENCIES,
  flightSearchIntentSchema,
  parseAmount,
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

interface Draft {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate: string;
  budget: string;
  theme: string;
  excludeRedEye: boolean;
  directOnly: boolean;
}

function toDraft(intent: FlightSearchIntent): Draft {
  return {
    origin: intent.origin,
    destination: intent.destination,
    departureDate: intent.departureDate,
    returnDate: intent.returnDate,
    budget:
      intent.budget === undefined
        ? ""
        : String(intent.budget / 10 ** CURRENCIES[intent.currency].decimals),
    theme: intent.theme ?? "",
    excludeRedEye: intent.excludeRedEye,
    directOnly: intent.directOnly,
  };
}

/** The Search button lives in the sticky bottom bar and submits this form by id. */
export const FLIGHT_SEARCH_FORM_ID = "flight-search-form";

export function FlightSearchForm({
  intent: active,
  revision,
  pending,
  onSearch,
}: {
  intent: FlightSearchIntent;
  /** Changes whenever a search runs, so the fields redraw even for an identical intent. */
  revision: number;
  pending: boolean;
  onSearch: (intent: FlightSearchIntent) => void;
}) {
  const currency = active.currency;
  const [problem, setProblem] = useState<"fields" | "past" | null>(null);
  const today = new Date(Date.now()).toISOString().slice(0, 10);
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
      returnDate: draft.returnDate,
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
      className="ticket-panel grid gap-4 rounded-3xl border border-sprout-200 p-5 sm:grid-cols-2"
      aria-busy={pending}
    >
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2 sm:col-span-2">
        <AirportPicker
          name="origin"
          text={t("flight.origin")}
          value={draft.origin}
          popular={POPULAR_ORIGINS}
          onChange={(origin) => {
            set({ origin });
          }}
        />
        <button
          type="button"
          aria-label={t("flight.swap")}
          onClick={() => {
            set({ origin: draft.destination, destination: draft.origin });
          }}
          className="press-pill mb-1 grid size-10 place-items-center rounded-full border border-sprout-200 bg-sprout-50 font-bold focus-visible:outline-2 focus-visible:outline-sprout-700"
        >
          <span aria-hidden="true">⇄</span>
        </button>
        <AirportPicker
          name="destination"
          text={t("flight.destination")}
          value={draft.destination}
          popular={POPULAR_DESTINATIONS}
          onChange={(destination) => {
            set({ destination });
          }}
        />
      </div>
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
        <label className="flex items-center gap-2">
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
        <label className="flex items-center gap-2">
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
      {problem && (
        <p role="alert" className="text-sm text-red-700 sm:col-span-2">
          {problem === "past" ? t("flight.pastDate") : errorMessage("VALIDATION_FAILED")}
        </p>
      )}
    </form>
  );
}
