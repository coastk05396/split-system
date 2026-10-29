import { type Group, MAX_TRIP_DAYS } from "@split/shared";
import { Plane } from "lucide-react";
import { type SubmitEvent, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useGroup } from "../groups/api.js";
import {
  failureMessage,
  input,
  LoadError,
  Loading,
  primaryButton,
  ScreenHeader,
} from "../groups/ui.js";
import { t } from "../i18n/messages.js";
import { usePatchTrip } from "../trip/api.js";
import { tripLength } from "../trip/days.js";
import { Field, nullable } from "../trip/StopForm.js";

/**
 * Screen 29 as amended (旅行基本設定): destination, dates (at most 31 days) and notes. Only
 * Admins change them (decision 13); Members see them read-only.
 */
export function TripSettingsPage() {
  const id = useParams().id ?? "";
  const group = useGroup(id);
  if (group.isPending) return <Loading />;
  if (group.isError) return <LoadError error={group.error} onRetry={() => void group.refetch()} />;
  return <TripSettings key={group.data.updatedAt} group={group.data} />;
}

function TripSettings({ group }: { group: Group }) {
  const navigate = useNavigate();
  const save = usePatchTrip(group);
  const admin = group.me.role === "admin";
  const [destination, setDestination] = useState(group.tripDestination ?? "");
  const [start, setStart] = useState(group.tripStartDate ?? "");
  const [end, setEnd] = useState(group.tripEndDate ?? "");
  const [notes, setNotes] = useState(group.tripNotes ?? "");
  const [checked, setChecked] = useState(false);
  const length = start !== "" && end !== "" ? tripLength(start, end) : 1;
  const datesProblem = length < 1 || length > MAX_TRIP_DAYS ? t("trip.datesTooLong") : null;

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setChecked(true);
    if (datesProblem !== null) return;
    save.mutate(
      {
        tripDestination: nullable(destination),
        tripStartDate: nullable(start),
        tripEndDate: nullable(end),
        tripNotes: nullable(notes),
      },
      {
        onSuccess: () => void navigate(`/groups/${group.id}?tab=trip`, { replace: true }),
      },
    );
  }

  return (
    <form noValidate onSubmit={submit} className="flex max-w-xl flex-col gap-5">
      <ScreenHeader
        title={t("trip.settingsTitle")}
        back={`/groups/${group.id}?tab=trip`}
        subtitle={t("trip.settingsBody")}
      />
      <section className="flex items-center gap-3 rounded-3xl bg-sprout-150 p-5">
        <Plane aria-hidden="true" className="size-7 text-sprout-600" />
        <p className="text-xl font-bold">{group.name}</p>
      </section>
      {!admin && <p className="text-sm text-ink-muted">{t("trip.readOnly")}</p>}
      <Field label="trip.destination">
        {(id) => (
          <input
            id={id}
            value={destination}
            maxLength={50}
            disabled={!admin}
            onChange={(e) => {
              setDestination(e.target.value);
            }}
            className={input}
          />
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="trip.startDate">
          {(id) => (
            <input
              id={id}
              type="date"
              value={start}
              disabled={!admin}
              onChange={(e) => {
                setStart(e.target.value);
              }}
              className={input}
            />
          )}
        </Field>
        <Field label="trip.endDate">
          {(id) => (
            <input
              id={id}
              type="date"
              value={end}
              min={start === "" ? undefined : start}
              disabled={!admin}
              onChange={(e) => {
                setEnd(e.target.value);
              }}
              className={input}
            />
          )}
        </Field>
      </div>
      {checked && datesProblem !== null && (
        <p role="alert" className="text-sm text-red-700">
          {datesProblem}
        </p>
      )}
      <Field label="trip.notes">
        {(id) => (
          <textarea
            id={id}
            value={notes}
            rows={3}
            maxLength={500}
            disabled={!admin}
            onChange={(e) => {
              setNotes(e.target.value);
            }}
            className={input}
          />
        )}
      </Field>
      {save.isError && (
        <p role="alert" className="text-red-700">
          {failureMessage(save.error)}
        </p>
      )}
      {admin && (
        <button type="submit" disabled={save.isPending} className={primaryButton}>
          {t("trip.save")}
        </button>
      )}
    </form>
  );
}
