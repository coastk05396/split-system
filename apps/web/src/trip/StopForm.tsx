import { type Group, stopDayInTrip, stopTimesValid } from "@split/shared";
import { type ReactNode, type SubmitEvent, useId, useState } from "react";
import { failureMessage, input, primaryButton } from "../groups/ui.js";
import { type MessageId, t } from "../i18n/messages.js";
import { stopCategories } from "./categories.js";
import { dayLabel, mapsUrl } from "./days.js";

/** The add and edit form of screen 27 as amended: free-text name and location, a map link. */

export interface StopValues {
  dayDate: string;
  startTime: string;
  endTime: string;
  title: string;
  category: string;
  locationName: string;
  notes: string;
}

export function StopForm({
  group,
  initial,
  submitLabel,
  pending,
  error,
  onSubmit,
  footer,
}: {
  group: Group;
  initial: StopValues;
  submitLabel: MessageId;
  pending: boolean;
  error: unknown;
  onSubmit: (values: StopValues) => void;
  footer?: ReactNode;
}) {
  const [values, setValues] = useState(initial);
  const [checked, setChecked] = useState(false);
  const { tripStartDate: start, tripEndDate: end } = group;
  const dayProblem =
    values.dayDate === "" || !stopDayInTrip(values.dayDate, start, end)
      ? t("stop.dayOutside", {
          start: start === null ? "" : dayLabel(start),
          end: end === null ? "" : dayLabel(end),
        })
      : null;
  const timeProblem = stopTimesValid(nullable(values.startTime), nullable(values.endTime))
    ? null
    : t("stop.timeInvalid");
  const location = values.locationName.trim();
  const categories = stopCategories.includes(initial.category)
    ? stopCategories
    : [initial.category, ...stopCategories];

  const set = (key: keyof StopValues) => (value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
  };

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setChecked(true);
    if (dayProblem !== null || timeProblem !== null) return;
    onSubmit(values);
  }

  return (
    <form noValidate onSubmit={submit} className="flex max-w-xl flex-col gap-5">
      <Field label="stop.name">
        {(id) => (
          <input
            id={id}
            value={values.title}
            maxLength={50}
            placeholder={t("stop.namePlaceholder")}
            onChange={(e) => {
              set("title")(e.target.value);
            }}
            className={input}
          />
        )}
      </Field>
      <Field label="stop.day" problem={checked ? dayProblem : null}>
        {(id, describedBy) => (
          <input
            id={id}
            type="date"
            value={values.dayDate}
            min={start ?? undefined}
            max={end ?? undefined}
            aria-describedby={describedBy}
            onChange={(e) => {
              set("dayDate")(e.target.value);
            }}
            className={input}
          />
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="stop.startTime">
          {(id) => (
            <input
              id={id}
              type="time"
              value={values.startTime}
              onChange={(e) => {
                set("startTime")(e.target.value);
              }}
              className={input}
            />
          )}
        </Field>
        <Field label="stop.endTime" problem={checked ? timeProblem : null}>
          {(id, describedBy) => (
            <input
              id={id}
              type="time"
              value={values.endTime}
              aria-describedby={describedBy}
              onChange={(e) => {
                set("endTime")(e.target.value);
              }}
              className={input}
            />
          )}
        </Field>
      </div>
      <Field label="stop.category">
        {(id) => (
          <select
            id={id}
            value={values.category}
            onChange={(e) => {
              set("category")(e.target.value);
            }}
            className={input}
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="stop.location">
        {(id) => (
          <input
            id={id}
            value={values.locationName}
            maxLength={100}
            placeholder={t("stop.locationPlaceholder")}
            onChange={(e) => {
              set("locationName")(e.target.value);
            }}
            className={input}
          />
        )}
      </Field>
      {location !== "" && (
        <a
          href={mapsUrl(location)}
          target="_blank"
          rel="noreferrer"
          aria-label={t("trip.openMapFor", { place: location })}
          className="-mt-2 self-start text-sm font-bold text-sprout-600 underline"
        >
          {t("trip.openMap")}
        </a>
      )}
      <Field label="stop.notes">
        {(id) => (
          <textarea
            id={id}
            value={values.notes}
            maxLength={500}
            rows={3}
            placeholder={t("stop.notesPlaceholder")}
            onChange={(e) => {
              set("notes")(e.target.value);
            }}
            className={input}
          />
        )}
      </Field>
      <p className="text-sm text-ink-muted">{t("stop.hint")}</p>
      {error !== null && (
        <p role="alert" className="text-red-700">
          {failureMessage(error)}
        </p>
      )}
      <button
        type="submit"
        disabled={values.title.trim() === "" || pending}
        className={primaryButton}
      >
        {t(submitLabel)}
      </button>
      {footer}
    </form>
  );
}

export function Field({
  label,
  problem = null,
  children,
}: {
  label: MessageId;
  problem?: string | null;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-bold">
        {t(label)}
      </label>
      {children(id, problem === null ? undefined : `${id}-problem`)}
      {problem !== null && (
        <span id={`${id}-problem`} className="text-sm text-red-700">
          {problem}
        </span>
      )}
    </div>
  );
}

/** An empty field means "not set". */
export function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
