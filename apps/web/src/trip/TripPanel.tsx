import { CURRENCY_CODES, type Expense, formatAmount, type Group, type Stop } from "@split/shared";
import { CalendarDays, MapPin, NotebookText, Plus, Receipt, Settings } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { card, LoadError, Loading, primaryButton } from "../groups/ui.js";
import { t } from "../i18n/messages.js";
import { useStopExpenses, useStops } from "./api.js";
import { weekdayShort } from "../i18n/format.js";
import { categoryIcon } from "./categories.js";
import {
  dayLabel,
  localToday,
  mapsUrl,
  planDays,
  sortStops,
  timeRange,
  weekdayLabel,
} from "./days.js";

/**
 * The 行程 tab (screens 22, 26 and 28 as amended): Trip settings at a glance, a day picker,
 * and the chosen day's Stops sorted by time with no drag handles (decision 13).
 */
export function TripPanel({ group }: { group: Group }) {
  const stops = useStops(group.id);
  const [params, setParams] = useSearchParams();
  if (stops.isPending) return <Loading />;
  if (stops.isError) return <LoadError error={stops.error} onRetry={() => void stops.refetch()} />;

  const days = planDays(group.tripStartDate, group.tripEndDate, stops.data);
  const asked = params.get("day");
  const today = localToday();
  const day =
    (asked !== null && days.includes(asked) ? asked : undefined) ??
    (days.includes(today) ? today : days[0]);
  const choose = (next: string) => {
    setParams({ tab: "trip", day: next }, { replace: true });
  };

  return (
    <div className="flex flex-col gap-5">
      <TripSummary group={group} />
      {day === undefined ? (
        <TripEmpty group={group} />
      ) : (
        <>
          <DayPicker days={days} day={day} onChoose={choose} />
          <DayPlan
            group={group}
            day={day}
            index={days.indexOf(day)}
            stops={stops.data.filter((s) => s.dayDate === day)}
          />
        </>
      )}
    </div>
  );
}

function TripSummary({ group }: { group: Group }) {
  const { tripStartDate: start, tripEndDate: end } = group;
  return (
    <section className={`${card} flex items-start gap-3 bg-sprout-150 p-5`}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex items-center gap-2 text-lg font-bold">
          <MapPin aria-hidden="true" className="size-5 shrink-0 text-sprout-600" />
          {group.tripDestination ?? t("trip.noDestination")}
        </p>
        <p className="flex items-center gap-2 text-sm text-ink-muted">
          <CalendarDays aria-hidden="true" className="size-4 shrink-0" />
          {start !== null && end !== null
            ? t("trip.dates", { start: dayLabel(start), end: dayLabel(end) })
            : t("trip.noDates")}
        </p>
        {group.tripNotes !== null && (
          <p className="flex items-start gap-2 text-sm text-ink-muted">
            <NotebookText aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span className="whitespace-pre-line">{group.tripNotes}</span>
          </p>
        )}
      </div>
      {group.me.role === "admin" && (
        <Link
          to={`/groups/${group.id}/trip`}
          className="flex shrink-0 items-center gap-1 rounded-full bg-white px-3 py-2 text-sm font-bold"
        >
          <Settings aria-hidden="true" className="size-4" />
          {t("trip.settings")}
        </Link>
      )}
    </section>
  );
}

function TripEmpty({ group }: { group: Group }) {
  const admin = group.me.role === "admin";
  return (
    <section className="flex flex-col items-center gap-3 rounded-3xl bg-white p-6 text-center">
      <h2 className="text-lg font-bold">{t("trip.empty.title")}</h2>
      <p className="text-sm text-ink-muted">
        {t(admin ? "trip.empty.adminBody" : "trip.empty.memberBody")}
      </p>
      {admin && (
        <Link to={`/groups/${group.id}/trip`} className={`${primaryButton} py-3`}>
          {t("trip.settings")}
        </Link>
      )}
    </section>
  );
}

function DayPicker({
  days,
  day,
  onChoose,
}: {
  days: readonly string[];
  day: string;
  onChoose: (day: string) => void;
}) {
  return (
    <div
      role="group"
      aria-label={t("trip.days")}
      className="flex gap-1 overflow-x-auto rounded-2xl bg-sprout-150 p-1"
    >
      {days.map((d) => (
        <button
          key={d}
          type="button"
          aria-pressed={d === day}
          aria-label={`${dayLabel(d)} ${weekdayLabel(d)}`}
          onClick={() => {
            onChoose(d);
          }}
          className="flex min-w-14 flex-1 flex-col items-center rounded-xl py-2 text-ink-muted aria-pressed:bg-white aria-pressed:text-ink"
        >
          <span className="text-xs">{weekdayShort(d)}</span>
          <span className="text-lg font-bold">{d.slice(8).replace(/^0/, "")}</span>
        </button>
      ))}
    </div>
  );
}

function DayPlan({
  group,
  day,
  index,
  stops,
}: {
  group: Group;
  day: string;
  index: number;
  stops: readonly Stop[];
}) {
  const expenses = useStopExpenses(group.id);
  const date = dayLabel(day);
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-sm font-bold text-sprout-600">
        {t("trip.dayHeading", {
          n: String(index + 1).padStart(2, "0"),
          date: `${date} ${weekdayLabel(day)}`,
        })}
      </h2>
      {stops.length === 0 ? (
        <p className="rounded-3xl bg-white p-6 text-center text-sm text-ink-muted">
          {t("trip.dayEmpty")}
        </p>
      ) : (
        <ol aria-label={t("trip.dayStops", { date })} className="flex flex-col gap-3">
          {sortStops(stops).map((stop) => (
            <StopCard
              key={stop.id}
              groupId={group.id}
              stop={stop}
              expenses={(expenses.data ?? []).filter((e) => e.stopId === stop.id)}
            />
          ))}
        </ol>
      )}
      <Link to={`/groups/${group.id}/stops/new?day=${day}`} className={`${primaryButton} py-3`}>
        <Plus aria-hidden="true" className="size-5" />
        {t("trip.addStop")}
      </Link>
    </section>
  );
}

function StopCard({
  groupId,
  stop,
  expenses,
}: {
  groupId: string;
  stop: Stop;
  expenses: readonly Expense[];
}) {
  const Icon = categoryIcon(stop.category);
  const time = timeRange(stop);
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="mt-3 flex size-9 shrink-0 items-center justify-center rounded-full bg-peach text-sprout-700"
      >
        <Icon className="size-4" />
      </span>
      <div className={`${card} flex min-w-0 flex-1 flex-col gap-1 p-4`}>
        <Link to={`/groups/${groupId}/stops/${stop.id}`} className="flex flex-col gap-1">
          {time !== null && <span className="text-sm font-bold text-sprout-600">{time}</span>}
          <h3 className="text-lg font-bold">{stop.title}</h3>
          <span className="text-sm text-ink-muted">
            {[stop.category, stop.locationName].filter((x) => x !== null).join(" · ")}
          </span>
        </Link>
        {stop.notes !== null && (
          <p className="text-sm whitespace-pre-line text-ink-muted">{stop.notes}</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {expenses.length > 0 && <LinkedExpenses expenses={expenses} />}
          {stop.locationName !== null && (
            <a
              href={mapsUrl(stop.locationName)}
              target="_blank"
              rel="noreferrer"
              aria-label={t("trip.openMapFor", { place: stop.locationName })}
              className="text-sm font-bold text-sprout-600 underline"
            >
              {t("trip.openMap")}
            </a>
          )}
        </div>
      </div>
    </li>
  );
}

/** The 已附加開銷 chip: how many Expenses link to the Stop, summed per currency, never converted. */
export function LinkedExpenses({ expenses }: { expenses: readonly Expense[] }) {
  const amount = CURRENCY_CODES.flatMap((currency) => {
    const inCurrency = expenses.filter((e) => e.originalCurrency === currency);
    if (inCurrency.length === 0) return [];
    return [
      formatAmount(
        inCurrency.reduce((sum, e) => sum + e.originalAmount, 0),
        currency,
      ),
    ];
  }).join(" · ");
  return (
    <span className="flex items-center gap-1 rounded-full bg-sprout-100 px-3 py-1 text-xs font-bold text-sprout-700">
      <Receipt aria-hidden="true" className="size-3.5" />
      {t("trip.linkedExpenses", { count: expenses.length, amount })}
    </span>
  );
}
