import { type Group } from "@split/shared";
import { ArrowRight, ChevronRight, Plus, Search } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { useGroups } from "../groups/api.js";
import { AvatarStack } from "../groups/AvatarStack.js";
import { balanceLine } from "../groups/totals.js";
import { GroupAvatar, LoadError, Loading, MaintenanceTag, primaryButton } from "../groups/ui.js";
import { t } from "../i18n/messages.js";
import { PressableLink } from "../shell/PressableLink.js";
import { SproutMascot } from "../shell/SproutMascot.js";
import { TRIP_ENABLED } from "../trip/enabled.js";

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
    <div className="flex flex-col gap-4 md:gap-6">
      <header>
        <h1 className="text-xl font-bold md:text-3xl">{t("groups.heading")}</h1>
      </header>
      <label className="flex items-center gap-2.5 rounded-2xl border border-sprout-200 bg-white px-3.5 py-2.5">
        <Search aria-hidden="true" className="size-4.5 text-ink-muted" />
        <input
          type="search"
          aria-label={t("groups.search")}
          placeholder={t("groups.search")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          className="w-full bg-transparent text-sm outline-none"
        />
      </label>
      {shown.length === 0 && (
        <p className="text-sm text-ink-muted">{t("groups.noMatch", { query: needle })}</p>
      )}
      <ul aria-label={t("groups.heading")} className="grid gap-2.5 md:grid-cols-2 md:gap-4">
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
  const balance = group.me.balance;
  return (
    <PressableLink
      to={`/groups/${group.id}`}
      className="surface-card group flex items-center gap-3.5 rounded-2xl border border-sprout-200/80 bg-white px-4 py-3 hover:border-sprout-500 hover:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.95),0_10px_22px_-14px_#143f2a] active:bg-sprout-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sprout-600"
    >
      <GroupAvatar name={group.name} groupId={group.id} className="size-11 text-base md:size-12 md:text-lg" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
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
          <span
            className={
              balance < 0
                ? "font-semibold text-red-700"
                : balance > 0
                  ? "font-semibold text-sprout-700"
                  : ""
            }
          >
            {balance === 0 ? t("groups.settled") : balanceLine(balance, group.settlementCurrency)}
          </span>
        </span>
        <AvatarStack members={group.memberPreview} total={group.memberCount} />
      </span>
      <ChevronRight
        aria-hidden="true"
        className="size-5 text-ink-muted transition-transform duration-180 ease-(--ease-out-expo) group-hover:translate-x-1 motion-reduce:group-hover:translate-x-0"
      />
    </PressableLink>
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
        <span className="empty-bloom flex size-56 items-center justify-center rounded-full bg-sprout-150 shadow-[inset_0_2px_0_0_rgb(255_255_255/0.8),0_12px_28px_-20px_#143f2a] ring-8 ring-sprout-100/60">
          <span className="sprout-greet inline-flex">
            <SproutMascot className="size-36" />
          </span>
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
