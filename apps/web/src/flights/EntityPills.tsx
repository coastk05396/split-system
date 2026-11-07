import {
  defaultFlightIntent,
  formatAmount,
  parseAmount,
  CURRENCIES,
  FLIGHT_THEMES,
  flightSearchIntentSchema,
  type FlightSearchIntent,
} from "@split/shared";
import { useState, type SubmitEvent } from "react";
import { input, primaryButton } from "../groups/ui.js";
import { errorMessage, t } from "../i18n/messages.js";

export function EntityPills({
  intent,
  pending,
  onChange,
}: {
  intent: FlightSearchIntent;
  pending: boolean;
  onChange: (intent: FlightSearchIntent) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const defaults = defaultFlightIntent(Date.now(), intent.currency);
  const { budget: _budget, ...withoutBudget } = intent;
  const { theme: _theme, ...withoutTheme } = intent;
  const pills = [
    {
      id: "origin",
      text: `${t("flight.origin")}: ${intent.origin}`,
      remove: () => {
        onChange({ ...intent, origin: defaults.origin });
      },
      removeLabel: t("flight.removeOrigin"),
    },
    {
      id: "destination",
      text: `${t("flight.destination")}: ${intent.destination}`,
      remove: () => {
        onChange({ ...intent, destination: defaults.destination });
      },
      removeLabel: t("flight.removeDestination"),
    },
    {
      id: "dates",
      text: `${t("flight.dates")}: ${intent.departureDate} – ${intent.returnDate}`,
      remove: () => {
        onChange({
          ...intent,
          departureDate: defaults.departureDate,
          returnDate: defaults.returnDate,
        });
      },
      removeLabel: t("flight.removeDates"),
    },
    ...(intent.budget !== undefined
      ? [
          {
            id: "budget",
            text: `${t("flight.budgetShort")}: ${formatAmount(intent.budget, intent.currency)}`,
            remove: () => {
              onChange(withoutBudget);
            },
            removeLabel: t("flight.removeBudget"),
          },
        ]
      : []),
    ...(intent.theme
      ? [
          {
            id: "theme",
            text: t(`flight.theme.${intent.theme}`),
            remove: () => {
              onChange(withoutTheme);
            },
            removeLabel: t("flight.removeTheme"),
          },
        ]
      : []),
    ...(intent.excludeRedEye
      ? [
          {
            id: "excludeRedEye",
            text: t("flight.excludes"),
            remove: () => {
              onChange({ ...intent, excludeRedEye: false });
            },
            removeLabel: t("flight.removeRedEye"),
          },
        ]
      : []),
    ...(intent.directOnly
      ? [
          {
            id: "directOnly",
            text: t("flight.direct"),
            remove: () => {
              onChange({ ...intent, directOnly: false });
            },
            removeLabel: t("flight.removeDirect"),
          },
        ]
      : []),
  ];
  return (
    <section aria-label={t("flight.conditions")} className="my-5 flex flex-wrap gap-2">
      {pills.map((pill) => (
        <span
          key={pill.id}
          className="inline-flex overflow-hidden rounded-full border border-sprout-200 bg-sprout-50 text-sm"
        >
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setEditing(pill.id);
            }}
            className="press-pill px-3 py-2 font-bold focus-visible:outline-2 focus-visible:outline-sprout-700"
          >
            {pill.text}
          </button>
          <button
            type="button"
            disabled={pending}
            aria-label={pill.removeLabel}
            onClick={() => {
              setEditing(null);
              pill.remove();
            }}
            className="px-3 py-2 hover:bg-sprout-150 focus-visible:outline-2 focus-visible:outline-sprout-700"
          >
            ×
          </button>
        </span>
      ))}
      {editing && (
        <PillEditor
          key={editing}
          editing={editing}
          intent={intent}
          pending={pending}
          onChange={onChange}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}

function PillEditor({
  editing,
  intent,
  pending,
  onChange,
  onClose,
}: {
  editing: string;
  intent: FlightSearchIntent;
  pending: boolean;
  onChange: (intent: FlightSearchIntent) => void;
  onClose: () => void;
}) {
  const [invalid, setInvalid] = useState(false);
  function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const patch: Record<string, unknown> = Object.fromEntries(form);
    if (editing === "budget") {
      const raw = form.get("budget");
      if (raw === "") patch.budget = undefined;
      else {
        const amount = parseAmount(typeof raw === "string" ? raw : "", intent.currency);
        if (!amount.ok) {
          setInvalid(true);
          return;
        }
        patch.budget = amount.value;
      }
    }
    if (editing === "theme" && patch.theme === "") patch.theme = undefined;
    if (editing === "excludeRedEye" || editing === "directOnly") patch[editing] = form.has(editing);
    const parsed = flightSearchIntentSchema.safeParse({ ...intent, ...patch });
    setInvalid(!parsed.success);
    if (parsed.success) {
      onClose();
      onChange(parsed.data);
    }
  }
  return (
    <form
      aria-label={t("flight.editCondition")}
      onSubmit={save}
      className="surface-card flex w-full flex-wrap items-end gap-3 rounded-2xl border border-sprout-200 bg-white p-4"
    >
      {(editing === "origin" || editing === "destination") && (
        <label className="grid gap-1 text-sm font-bold">
          {t(editing === "origin" ? "flight.origin" : "flight.destination")}
          <input
            autoFocus
            className={input}
            name={editing}
            defaultValue={intent[editing]}
            pattern="[A-Z]{3}"
            required
            maxLength={3}
          />
        </label>
      )}
      {editing === "dates" && (
        <>
          <label className="grid gap-1 text-sm font-bold">
            {t("flight.departure")}
            <input
              autoFocus
              className={input}
              name="departureDate"
              type="date"
              required
              defaultValue={intent.departureDate}
            />
          </label>
          <label className="grid gap-1 text-sm font-bold">
            {t("flight.return")}
            <input
              className={input}
              name="returnDate"
              type="date"
              required
              defaultValue={intent.returnDate}
            />
          </label>
        </>
      )}
      {editing === "budget" && (
        <label className="grid gap-1 text-sm font-bold">
          {t("flight.budgetShort")} · {intent.currency}
          <input
            autoFocus
            className={input}
            type="number"
            name="budget"
            min="1"
            step={10 ** -CURRENCIES[intent.currency].decimals}
            defaultValue={
              intent.budget === undefined
                ? ""
                : intent.budget / 10 ** CURRENCIES[intent.currency].decimals
            }
          />
        </label>
      )}
      {editing === "theme" && (
        <label className="grid gap-1 text-sm font-bold">
          {t("flight.theme")}
          <select autoFocus name="theme" defaultValue={intent.theme ?? ""} className={input}>
            <option value="">{t("flight.theme.none")}</option>
            {FLIGHT_THEMES.map((theme) => (
              <option key={theme} value={theme}>
                {t(`flight.theme.${theme}`)}
              </option>
            ))}
          </select>
        </label>
      )}
      {(editing === "excludeRedEye" || editing === "directOnly") && (
        <label className="flex items-center gap-2 text-sm">
          <input autoFocus type="checkbox" name={editing} defaultChecked={intent[editing]} />
          {t(editing === "excludeRedEye" ? "flight.excludes" : "flight.direct")}
        </label>
      )}
      <button type="submit" className={primaryButton} disabled={pending}>
        {t("flight.apply")}
      </button>
      <button
        type="button"
        className="press-pill px-4 py-3 text-sm font-bold"
        onClick={() => {
          onClose();
        }}
      >
        {t("common.cancel")}
      </button>
      {invalid && (
        <p role="alert" className="w-full text-sm text-red-700">
          {errorMessage("VALIDATION_FAILED")}
        </p>
      )}
    </form>
  );
}
