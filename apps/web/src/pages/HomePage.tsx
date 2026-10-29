import { ArrowRight, Plane, Plus, ReceiptText } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { useAuth } from "../auth/AuthProvider.js";
import { useGroups } from "../groups/api.js";
import { formatTotals, pendingTotals } from "../groups/totals.js";
import { t } from "../i18n/messages.js";
import { SproutMark } from "../shell/SproutMark.js";

/** Screen 2: the person's pending Balances per currency and the two ways to start. */
export function HomePage() {
  const { state } = useAuth();
  const name = state.status === "signedIn" ? state.user.displayName : "";
  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold md:text-4xl">{t("home.greeting", { name })}</h1>
          <p className="mt-1 text-sm text-ink-muted md:text-base">{t("home.subtitle")}</p>
        </div>
        <SproutMark className="size-14" />
      </header>
      <BalanceCard />
      <section aria-labelledby="quick-start" className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 id="quick-start" className="text-xl font-bold">
            {t("home.quickStart")}
          </h2>
          <Link to="/groups" className="flex items-center gap-1 text-sm font-bold text-sprout-600">
            {t("home.viewGroups")}
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <StartCard
            to="/groups/new?usage=trip"
            icon={<Plane aria-hidden="true" className="size-7 text-sprout-500" />}
            iconClass="bg-sprout-100"
            title={t("home.trip.title")}
            body={t("home.trip.body")}
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
      <Link
        to="/groups/new"
        className="flex items-center justify-between rounded-full bg-sprout-500 px-6 py-4 font-bold text-white hover:bg-sprout-500/90"
      >
        <span className="flex items-center gap-2">
          <Plus aria-hidden="true" className="size-5" />
          {t("home.create")}
        </span>
        <ArrowRight aria-hidden="true" className="size-5" />
      </Link>
    </div>
  );
}

function BalanceCard() {
  const groups = useGroups();
  const summary = pendingTotals(groups.data ?? []);
  return (
    <section
      aria-labelledby="home-balance"
      className="rounded-3xl bg-sprout-500 p-6 text-white shadow-sm"
    >
      <h2 id="home-balance" className="text-sm text-white/85">
        {t("home.balance")}
      </h2>
      {groups.isSuccess ? (
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
