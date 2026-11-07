import {
  CURRENCIES,
  flightSearchIntentSchema,
  parseAmount,
  FLIGHT_THEMES,
  type FlightSearchIntent,
} from "@split/shared";
import { useState, type RefObject, type SubmitEvent } from "react";
import { failureMessage, input, primaryButton } from "../groups/ui.js";
import { errorMessage, t } from "../i18n/messages.js";

export function FlightSearchForm({
  intent: active,
  pending,
  error,
  onSearch,
  formRef,
}: {
  intent: FlightSearchIntent;
  pending: boolean;
  error: unknown;
  onSearch: (intent: FlightSearchIntent) => void;
  formRef: RefObject<HTMLFormElement | null>;
}) {
  const currency = active.currency;
  const [invalid, setInvalid] = useState(false);
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
      theme: form.get("theme") || undefined,
    });
    setInvalid(!parsed.success);
    if (parsed.success) onSearch(parsed.data);
  }

  return (
    <form
      key={JSON.stringify(active)}
      ref={formRef}
      onSubmit={submit}
      className="surface-card grid gap-4 rounded-3xl border border-sprout-200 bg-white p-5 sm:grid-cols-2"
      aria-busy={pending}
    >
      <label className="grid gap-1 text-sm font-bold">
        {t("flight.origin")}
        <input
          className={input}
          name="origin"
          defaultValue={active.origin}
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
          defaultValue={active.destination}
          required
          pattern="[A-Z]{3}"
          maxLength={3}
          autoCapitalize="characters"
          placeholder="NRT"
        />
      </label>
      <label className="grid gap-1 text-sm font-bold">
        {t("flight.departure")}
        <input
          className={input}
          name="departureDate"
          defaultValue={active.departureDate}
          type="date"
          required
        />
      </label>
      <label className="grid gap-1 text-sm font-bold">
        {t("flight.return")}
        <input
          className={input}
          name="returnDate"
          defaultValue={active.returnDate}
          type="date"
          required
        />
      </label>
      <label className="grid gap-1 text-sm font-bold">
        {t("flight.budget")} · {currency}
        <input
          className={input}
          name="budget"
          defaultValue={
            active.budget === undefined ? "" : active.budget / 10 ** CURRENCIES[currency].decimals
          }
          type="number"
          min="1"
          step={10 ** -CURRENCIES[currency].decimals}
        />
      </label>
      <label className="grid gap-1 text-sm font-bold">
        {t("flight.theme")}
        <select name="theme" defaultValue={active.theme ?? ""} className={input}>
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
          <input type="checkbox" name="excludeRedEye" defaultChecked={active.excludeRedEye} />
          {t("flight.excludes")}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="directOnly" defaultChecked={active.directOnly} />
          {t("flight.direct")}
        </label>
      </div>
      {invalid && (
        <p role="alert" className="text-sm text-red-700 sm:col-span-2">
          {errorMessage("VALIDATION_FAILED")}
        </p>
      )}
      {error != null && (
        <p role="alert" className="text-sm text-red-700 sm:col-span-2">
          {failureMessage(error)}
        </p>
      )}
      <button type="submit" className={`${primaryButton} sm:col-span-2`} disabled={pending}>
        {t("flight.search")}
      </button>
    </form>
  );
}
