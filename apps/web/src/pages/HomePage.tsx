import { formatAmount, type Group } from "@split/shared";
import { ArrowRight, ChevronRight, Plane, ReceiptText } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { useAuth } from "../auth/AuthProvider.js";
import { useGroups } from "../groups/api.js";
import { formatTotals, pendingTotals } from "../groups/totals.js";
import { card } from "../groups/ui.js";
import { t } from "../i18n/messages.js";
import { SproutMark } from "../shell/SproutMark.js";

/** Screen 2: the person's pending Balances per currency and active groups or quick start. */
export function HomePage() {
  const { state } = useAuth();
  const name = state.status === "signedIn" ? state.user.displayName : "";
  const groupsQuery = useGroups();
  const groups = groupsQuery.data ?? [];

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold md:text-4xl">{t("home.greeting", { name })}</h1>
          <p className="mt-1 text-sm text-ink-muted md:text-base">{t("home.subtitle")}</p>
        </div>
        <SproutMark className="size-14" />
      </header>

      <BalanceCard groups={groups} isSuccess={groupsQuery.isSuccess} />

      {groups.length === 0 ? <QuickStartSection /> : <ActiveGroupsSection groups={groups} />}
    </div>
  );
}

function BalanceCard({ groups, isSuccess }: { groups: Group[]; isSuccess: boolean }) {
  const summary = pendingTotals(groups);
  const pendingGroups = groups.filter((g) => g.me.balance !== 0);
  const settleHref =
    pendingGroups.length === 1 && pendingGroups[0]
      ? `/groups/${pendingGroups[0].id}?tab=settle`
      : "/groups";

  return (
    <section
      aria-labelledby="home-balance"
      className="rounded-3xl bg-sprout-500 p-6 text-white shadow-sm"
    >
      <div className="flex items-center justify-between">
        <h2 id="home-balance" className="text-sm text-white/85">
          {t("home.balance")}
        </h2>
        {isSuccess && summary.pendingGroups > 0 && (
          <Link
            to={settleHref}
            className="flex items-center gap-1 text-xs font-bold text-white/95 underline underline-offset-2 hover:text-white"
          >
            {t("home.viewSettlement")}
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        )}
      </div>
      {isSuccess ? (
        <>
          <p className="mt-4 text-3xl font-bold tabular-nums md:text-4xl">
            {formatTotals(summary)}
          </p>
          <p className="mt-3 text-sm text-white/85">
            {summary.pendingGroups === 0
              ? t("home.noPending")
              : t("home.pending", { count: summary.pendingGroups })}
          </p>
        </>
      ) : (
        <p className="mt-4 h-10 animate-pulse rounded-lg bg-white/15" aria-busy="true" />
      )}
    </section>
  );
}

function QuickStartSection() {
  return (
    <section aria-labelledby="quick-start" className="flex flex-col gap-4">
      <h2 id="quick-start" className="text-xl font-bold">
        {t("home.quickStart")}
      </h2>
      <div className="grid gap-4 md:grid-cols-2">
        <StartCard
          to="/groups/new?usage=trip"
          icon={<Plane aria-hidden="true" className="size-7 text-sprout-500" />}
          iconClass="bg-sprout-100"
          title={t("home.trip.title")}
          body={t("home.trip.body")}
          hint={t("home.trip.hint")}
        />
        <StartCard
          to="/groups/new?usage=tab"
          icon={<ReceiptText aria-hidden="true" className="size-7 text-sprout-500" />}
          iconClass="bg-peach"
          title={t("home.tab.title")}
          body={t("home.tab.body")}
          hint={t("home.tab.hint")}
        />
      </div>
    </section>
  );
}

function ActiveGroupsSection({ groups }: { groups: Group[] }) {
  // Sort: non-zero balance first, then recently updated
  const sorted = [...groups].sort((a, b) => {
    const aPending = a.me.balance !== 0 ? 1 : 0;
    const bPending = b.me.balance !== 0 ? 1 : 0;
    if (aPending !== bPending) return bPending - aPending;
    return b.updatedAt - a.updatedAt;
  });

  const topGroups = sorted.slice(0, 3);

  return (
    <section aria-labelledby="active-groups" className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 id="active-groups" className="text-xl font-bold">
          {t("home.myGroups")}
        </h2>
        <Link
          to="/groups/new"
          className="flex items-center gap-1 text-sm font-bold text-sprout-600 hover:text-sprout-700"
        >
          {t("home.newGroup")}
        </Link>
      </div>

      <ul className="flex flex-col gap-3">
        {topGroups.map((g) => (
          <li key={g.id}>
            <HomeGroupRow group={g} />
          </li>
        ))}
      </ul>

      {groups.length > 3 && (
        <Link
          to="/groups"
          className="flex items-center justify-center gap-1.5 py-2 text-sm font-bold text-sprout-600 hover:text-sprout-700"
        >
          {t("home.viewAllGroups", { count: groups.length })}
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      )}
    </section>
  );
}

function HomeGroupRow({ group }: { group: Group }) {
  const balance = group.me.balance;
  return (
    <Link
      to={`/groups/${group.id}`}
      className={`${card} flex items-center justify-between p-4.5 hover:border-sprout-500`}
    >
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-base font-bold">{group.name}</span>
          <span className="shrink-0 rounded-full bg-sprout-150 px-2 py-0.5 text-xs text-sprout-600">
            {t(group.isTrip ? "usage.trip" : "usage.tab")}
          </span>
        </span>
        <span className="text-xs text-ink-muted">
          {t("groups.people", { count: group.memberCount })}
          {" · "}
          {balance === 0
            ? t("groups.settled")
            : t("groups.pending", { amount: formatAmount(balance, group.settlementCurrency) })}
        </span>
      </span>
      <ChevronRight aria-hidden="true" className="size-5 text-ink-muted" />
    </Link>
  );
}

function StartCard(props: {
  to: string;
  icon: ReactNode;
  iconClass: string;
  title: string;
  body: string;
  hint?: string;
}) {
  return (
    <Link
      to={props.to}
      className="flex items-center gap-4 rounded-3xl border border-sprout-200 bg-white p-5 hover:border-sprout-500"
    >
      <span
        className={`flex size-14 shrink-0 items-center justify-center rounded-2xl ${props.iconClass}`}
      >
        {props.icon}
      </span>
      <span className="flex flex-col gap-1">
        <span className="text-lg font-bold">{props.title}</span>
        <span className="text-sm text-ink-muted">{props.body}</span>
        {props.hint !== undefined && (
          <span className="text-xs font-bold text-sprout-600">{props.hint}</span>
        )}
      </span>
    </Link>
  );
}
