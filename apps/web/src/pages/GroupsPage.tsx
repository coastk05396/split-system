import { formatAmount, type Group } from "@split/shared";
import { ArrowRight, ChevronRight, House, Plane, Plus, Search } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { useGroups } from "../groups/api.js";
import { card, LoadError, Loading, primaryButton } from "../groups/ui.js";
import { t } from "../i18n/messages.js";
import { SproutMark } from "../shell/SproutMark.js";

/** Screen 12 (group list) and screen 19 (no Groups yet). */
export function GroupsPage() {
  const groups = useGroups();
  const [query, setQuery] = useState("");

  if (groups.isPending) return <Loading />;
  if (groups.isError) {
    return <LoadError error={groups.error} onRetry={() => void groups.refetch()} />;
  }
  if (groups.data.length === 0) return <NoGroups />;

  const needle = query.trim();
  const shown = groups.data.filter((g) => g.name.includes(needle));
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold md:text-3xl">{t("groups.heading")}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t("groups.subtitle")}</p>
      </header>
      <label className="flex items-center gap-3 rounded-2xl border border-sprout-200 bg-white px-4 py-3">
        <Search aria-hidden="true" className="size-5 text-ink-muted" />
        <input
          type="search"
          aria-label={t("groups.search")}
          placeholder={t("groups.search")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          className="w-full bg-transparent outline-none"
        />
      </label>
      {shown.length === 0 && (
        <p className="text-ink-muted">{t("groups.noMatch", { query: needle })}</p>
      )}
      <ul aria-label={t("groups.heading")} className="grid gap-4 md:grid-cols-2">
        {shown.map((g) => (
          <li key={g.id}>
            <GroupRow group={g} />
          </li>
        ))}
      </ul>
      <Link to="/groups/new" className={`${primaryButton} justify-between`}>
        <span className="flex items-center gap-2">
          <Plus aria-hidden="true" className="size-5" />
          {t("groups.create")}
        </span>
        <ArrowRight aria-hidden="true" className="size-5" />
      </Link>
    </div>
  );
}

function GroupRow({ group }: { group: Group }) {
  const Icon = group.isTrip ? Plane : House;
  const balance = group.me.balance;
  return (
    <Link
      to={`/groups/${group.id}`}
      className={`${card} flex items-center gap-4 p-5 hover:border-sprout-500`}
    >
      <span
        className={`flex size-14 shrink-0 items-center justify-center rounded-2xl ${
          group.isTrip ? "bg-sprout-100" : "bg-peach"
        }`}
      >
        <Icon aria-hidden="true" className="size-7 text-sprout-500" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-lg font-bold">{group.name}</span>
          <span className="shrink-0 rounded-full bg-sprout-150 px-2 py-0.5 text-xs text-sprout-600">
            {t(group.isTrip ? "usage.trip" : "usage.tab")}
          </span>
        </span>
        <span className="text-sm text-ink-muted">
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

function NoGroups() {
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-bold md:text-3xl">{t("groups.heading")}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t("groups.count", { count: 0 })}</p>
      </header>
      <div className="flex flex-col items-center gap-6 py-6 text-center">
        <span className="flex size-56 items-center justify-center rounded-full bg-sprout-150">
          <SproutMark className="size-28" />
        </span>
        <h2 className="text-xl font-bold">{t("groups.empty.title")}</h2>
        <p className="text-ink-muted">
          {t("groups.empty.body1")}
          <br />
          {t("groups.empty.body2")}
        </p>
      </div>
      <Link to="/groups/new" className={primaryButton}>
        {t("groups.empty.create")}
      </Link>
    </div>
  );
}
