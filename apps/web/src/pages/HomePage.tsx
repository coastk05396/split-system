import { type CurrencyCode, formatAmount, type Group } from "@split/shared";
import { ArrowRight, Check, ChevronRight, Plane, ReceiptText, Users } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { useAuth } from "../auth/AuthProvider.js";
import { useGroups } from "../groups/api.js";
import { useRates } from "../expenses/api.js";
import { localNow } from "../expenses/expense-draft.js";
import { balanceLine, convertedTotal, pendingTotals } from "../groups/totals.js";
import { LoadError, MaintenanceTag } from "../groups/ui.js";
import { t } from "../i18n/messages.js";
import { PressableLink } from "../shell/PressableLink.js";
import { SproutMark } from "../shell/SproutMark.js";
import { TRIP_ENABLED } from "../trip/enabled.js";

/** Screen 2: the person's pending Balances per currency, the Groups owing something, and the two ways to start a Group. */
export function HomePage() {
  const { state } = useAuth();
  const name = state.status === "signedIn" ? state.user.displayName : "";
  const preferred = state.status === "signedIn" ? state.user.preferredCurrency : "TWD";
  const groupsQuery = useGroups();
  const groups = groupsQuery.data ?? [];

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-start justify-between gap-3">
        <h1 className="text-balance text-2xl leading-tight font-bold md:text-4xl">
          {t("home.greeting", { name })}
        </h1>
        <SproutMark className="size-12 md:size-14" />
      </header>

      {groupsQuery.isError ? (
        <LoadError error={groupsQuery.error} onRetry={() => void groupsQuery.refetch()} />
      ) : (
        <>
          <BalanceCard groups={groups} preferred={preferred} isSuccess={groupsQuery.isSuccess} />
          {groupsQuery.isSuccess && (
            <>
              {groups.length > 0 && <ActiveGroupsSection groups={groups} />}
              <QuickStartSection hasGroups={groups.length > 0} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function BalanceCard(props: { groups: Group[]; preferred: CurrencyCode; isSuccess: boolean }) {
  const { groups, preferred, isSuccess } = props;
  const summary = pendingTotals(groups, preferred);
  const [main, ...rest] = summary.totals;
  // Another currency with something pending is converted into the Preferred currency.
  const foreign = rest.filter((x) => x.amount !== 0);
  const today = localNow(new Date()).date;
  const rates = useRates(
    today,
    preferred,
    foreign.map((x) => x.currency),
  );
  const waiting = foreign.length > 0 && rates.some((r) => r.isPending);
  const unavailable = foreign.length > 0 && rates.some((r) => r.isError);
  const rateByCurrency = new Map(
    foreign.flatMap((x, i) => {
      const rate = rates[i]?.data;
      return rate === undefined ? [] : [[x.currency, rate.rateScaled] as const];
    }),
  );
  // Each pair can answer for a different day; the note says so rather than naming one.
  const rateDates = [
    ...new Set(rates.flatMap((r) => (r.data === undefined ? [] : [r.data.rateDate]))),
  ].sort();
  const total =
    foreign.length > 0 && !unavailable
      ? convertedTotal(summary.totals, preferred, rateByCurrency)
      : null;
  const converting = total !== null;
  // No rate, or a currency that cannot be converted: nothing is dropped, each stays in view.
  const sideBySide = foreign.length > 0 && !converting;
  const rateNote = converting
    ? rateDates.length > 1
      ? t("home.rateNoteRange", { from: rateDates[0] ?? today, to: rateDates.at(-1) ?? today })
      : t("home.rateNote", { date: rateDates[0] ?? today })
    : null;

  return (
    <section
      aria-labelledby="home-balance"
      className="rounded-3xl bg-sprout-500 p-6 text-white shadow-[0_8px_18px_-14px_#143f2a]"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="home-balance" className="text-sm text-white/85">
          {t("home.balance")}
        </h2>
        <Link
          to="/settings"
          aria-label={t("home.currencyTag", { currency: preferred })}
          className="flex min-h-9 items-center gap-0.5 rounded-full bg-white/15 px-3 py-1 text-xs font-bold text-white transition-colors hover:bg-white/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          {preferred}
          <ChevronRight aria-hidden="true" className="size-3.5" />
        </Link>
      </div>
      {isSuccess && main !== undefined && !waiting ? (
        <>
          <p
            className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 tabular-nums"
            {...(rateNote === null
              ? {}
              : { title: rateNote, "aria-describedby": "home-rate-note" })}
          >
            <span className="text-3xl font-bold tracking-tight md:text-4xl">
              {formatAmount(converting ? total : main.amount, main.currency)}
            </span>
            {sideBySide &&
              foreign.map((x) => (
                <span key={x.currency} className="text-lg text-white/75">
                  {formatAmount(x.amount, x.currency)}
                </span>
              ))}
          </p>
          {rateNote !== null && (
            <span id="home-rate-note" className="sr-only">
              {rateNote}
            </span>
          )}
          {summary.pendingGroups === 0 && (
            <p className="mt-5 flex items-center gap-2 border-t border-white/25 pt-3 text-sm text-white/90">
              <Check aria-hidden="true" className="size-4" />
              {t("home.noPending")}
            </p>
          )}
        </>
      ) : (
        <p className="mt-4 h-10 animate-pulse rounded-lg bg-white/15" aria-busy="true" />
      )}
    </section>
  );
}

function QuickStartSection({ hasGroups }: { hasGroups: boolean }) {
  return (
    <section aria-labelledby="quick-start" className="flex flex-col gap-4">
      <h2 id="quick-start" className="text-xl font-bold">
        {t("home.quickStart")}
      </h2>
      <div className="grid gap-4 md:grid-cols-2">
        <StartCard
          // With Groups already, 快速分帳 means 記在哪個群組, with 建立新群組 on that list.
          to={hasGroups ? "/new?pick=1" : "/groups/new?usage=tab"}
          icon={<ReceiptText aria-hidden="true" className="size-7 text-sprout-500" />}
          iconClass="bg-peach"
          title={t("home.tab.title")}
          body={t("home.tab.body")}
          hint={t("home.tab.hint")}
        />
        <StartCard
          to="/groups/new?usage=trip"
          icon={<Plane aria-hidden="true" className="size-7 text-sprout-500" />}
          iconClass="bg-sprout-100"
          title={t("home.trip.title")}
          body={t("home.trip.body")}
          hint={t("home.trip.hint")}
          disabled={!TRIP_ENABLED}
        />
      </div>
    </section>
  );
}

function ActiveGroupsSection({ groups }: { groups: Group[] }) {
  // Only the Groups that still owe something, most recently updated first.
  const owing = groups.filter((g) => g.me.balance !== 0).sort((a, b) => b.updatedAt - a.updatedAt);
  const pending = owing.slice(0, 3);

  return (
    <section aria-labelledby="active-groups" className="flex flex-col gap-4">
      <h2 id="active-groups" className="text-xl font-bold">
        {t("home.pendingGroups")}
      </h2>

      {pending.length === 0 ? (
        <p className="rounded-3xl bg-sprout-150 px-5 py-4 font-bold text-sprout-600">
          {t("home.allSettled")}
        </p>
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-sprout-200 bg-white shadow-[0_5px_16px_-15px_#143f2a]">
          {pending.map((g) => (
            <li key={g.id} className="border-b border-sprout-200 last:border-b-0">
              <HomeGroupRow group={g} />
            </li>
          ))}
        </ul>
      )}

      {owing.length > pending.length && (
        <Link
          to="/groups"
          className="flex items-center justify-center gap-1.5 py-2 text-sm font-bold text-sprout-600 hover:text-sprout-700"
        >
          {t("home.morePending", { count: owing.length - pending.length })}
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      )}
    </section>
  );
}

function HomeGroupRow({ group }: { group: Group }) {
  const balance = group.me.balance;
  return (
    <PressableLink
      to={`/groups/${group.id}?tab=settle`}
      className="group flex items-center gap-3 px-4 py-3.5 text-ink transition-colors hover:bg-sprout-50 active:bg-sprout-100 focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-sprout-600"
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-sprout-100 text-sprout-600">
        <Users aria-hidden="true" className="size-5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-base font-bold">{group.name}</span>
          <span className="shrink-0 rounded-full bg-sprout-150 px-2 py-0.5 text-xs text-sprout-600">
            {t(group.isTrip ? "usage.trip" : "usage.tab")}
          </span>
          {group.isTrip && !TRIP_ENABLED && <MaintenanceTag />}
        </span>
        <span className="text-xs text-ink-muted">
          {t("groups.people", { count: group.memberCount })}
          {" · "}
          {balance === 0 ? t("groups.settled") : balanceLine(balance, group.settlementCurrency)}
        </span>
      </span>
      <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-ink-muted" />
    </PressableLink>
  );
}

function StartCard(props: {
  to: string;
  icon: ReactNode;
  iconClass: string;
  title: string;
  body: string;
  hint?: string;
  /** Under maintenance: shown with a red tag, not a link. */
  disabled?: boolean;
}) {
  const content = (
    <>
      <span
        className={`flex size-14 shrink-0 items-center justify-center rounded-2xl ${props.iconClass}`}
      >
        {props.icon}
      </span>
      <span className="flex flex-col gap-1">
        <span className="flex items-center gap-2">
          <span className="text-lg font-bold">{props.title}</span>
          {props.disabled === true && <MaintenanceTag />}
        </span>
        <span className="text-sm text-ink-muted">{props.body}</span>
        {props.hint !== undefined && (
          <span className="text-xs font-bold text-sprout-600">{props.hint}</span>
        )}
      </span>
    </>
  );
  if (props.disabled === true) {
    return (
      <div
        aria-disabled="true"
        className="flex items-center gap-4 rounded-3xl border border-sprout-200 bg-white p-5 opacity-60"
      >
        {content}
      </div>
    );
  }
  return (
    <PressableLink
      to={props.to}
      className="group flex items-center gap-4 rounded-3xl border border-sprout-200 bg-white p-5 shadow-[0_5px_16px_-17px_#143f2a] transition-[border-color,background-color,box-shadow] hover:border-sprout-500 hover:shadow-[0_8px_20px_-15px_#143f2a] active:bg-sprout-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sprout-600"
    >
      {content}
      <ChevronRight
        aria-hidden="true"
        className="size-5 shrink-0 text-sprout-600 transition-transform duration-150 group-hover:translate-x-1 motion-reduce:group-hover:translate-x-0"
      />
    </PressableLink>
  );
}
