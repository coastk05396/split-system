import * as Tabs from "@radix-ui/react-tabs";
import type { Group } from "@split/shared";
import { Plane, Plus, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ExpenseList } from "../expenses/ExpenseList.js";
import { useGroup } from "../groups/api.js";
import { DeleteGroupDialog } from "../groups/DeleteGroupDialog.js";
import { LoadError, Loading, MaintenanceTag, ScreenHeader } from "../groups/ui.js";
import { type MessageId, t } from "../i18n/messages.js";
import { SelectionPill } from "../shell/SelectionPill.js";
import { SettlePanel } from "../settlements/SettlePanel.js";
import { TRIP_ENABLED } from "../trip/enabled.js";
import { TripPanel } from "../trip/TripPanel.js";

const headerIcon =
  "flex h-11 min-w-11 items-center justify-center gap-1 rounded-full px-2 hover:bg-sprout-150";

/**
 * Screen 3 as amended: the same tabs everywhere, 帳目, 行程 (Trips only) and 結算, with the
 * delete action for Admins only. The tab contents arrive with the Expense, Trip and
 * Settlement screens.
 */
export function GroupPage() {
  const id = useParams().id ?? "";
  const group = useGroup(id);
  if (group.isPending) return <Loading />;
  if (group.isError) return <LoadError error={group.error} onRetry={() => void group.refetch()} />;
  return <GroupDetail group={group.data} />;
}

function GroupDetail({ group }: { group: Group }) {
  const tabs: { value: string; label: MessageId }[] = [
    { value: "expenses", label: "group.tab.expenses" },
    ...(group.isTrip && TRIP_ENABLED ? [{ value: "trip", label: "group.tab.trip" } as const] : []),
    { value: "settle", label: "group.tab.settle" },
  ];
  // `?tab=trip` or `?tab=settle` opens a tab directly
  const asked = useSearchParams()[0].get("tab") ?? "";
  const [activeTab, setActiveTab] = useState(
    tabs.some((tab) => tab.value === asked) ? asked : "expenses",
  );
  return (
    <div className="flex flex-col gap-6">
      <ScreenHeader
        compact
        title={group.name}
        back="/groups"
        action={
          <span className="flex items-center">
            <Link
              to={`/groups/${group.id}/members`}
              aria-label={t("group.summary", { count: group.memberCount })}
              className={headerIcon}
            >
              <Users aria-hidden="true" className="size-6" />
              <span className="text-sm font-bold">{group.memberCount}</span>
            </Link>
            <Link
              to={`/groups/${group.id}/invite`}
              aria-label={t("group.invite")}
              className={headerIcon}
            >
              <UserPlus aria-hidden="true" className="size-6" />
            </Link>
            {group.me.role === "admin" && <DeleteGroupDialog group={group} />}
          </span>
        }
        subtitle={
          group.isTrip ? (
            <span className="flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-1 rounded-full bg-peach px-3 py-1 text-xs font-bold text-sprout-700">
                <Plane aria-hidden="true" className="size-3.5" />
                {t("group.tripBadge")}
              </span>
              {!TRIP_ENABLED && <MaintenanceTag />}
            </span>
          ) : undefined
        }
      />
      {group.memberCount === 1 && (
        <section className="flex items-center gap-3 rounded-2xl bg-sprout-150 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-bold">{t("group.alone.title")}</h2>
            <p className="text-sm text-ink-muted">{t("group.alone.body")}</p>
          </div>
          <Link
            to={`/groups/${group.id}/invite`}
            className="shrink-0 rounded-full bg-sprout-500 px-4 py-2 text-sm font-bold text-white hover:bg-sprout-500/90"
          >
            {t("group.alone.invite")}
          </Link>
        </section>
      )}
      <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center gap-2">
          <Tabs.List
            aria-label={t("group.tabs")}
            className="flex flex-1 gap-1 rounded-2xl bg-sprout-150 p-1"
          >
            {tabs.map((tab) => (
              <Tabs.Trigger
                key={tab.value}
                value={tab.value}
                className="relative flex-1 rounded-xl py-2.5 text-ink-muted transition-colors data-[state=active]:font-bold data-[state=active]:text-ink focus-visible:outline-2 focus-visible:outline-sprout-600"
              >
                {activeTab === tab.value && (
                  <SelectionPill
                    layoutId={`group-tab-${group.id}`}
                    className="inset-0 rounded-xl bg-white shadow-[0_3px_10px_-7px_#143f2a] after:absolute after:bottom-1 after:left-1/2 after:h-0.5 after:w-6 after:-translate-x-1/2 after:rounded-full after:bg-sprout-500"
                  />
                )}
                <span className="relative">{t(tab.label)}</span>
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <Link
            to={`/groups/${group.id}/expenses/new`}
            aria-label={t("expense.new")}
            className="flex shrink-0 items-center gap-1 rounded-full bg-sprout-500 px-4 py-3 font-bold text-white hover:bg-sprout-500/90"
          >
            <Plus aria-hidden="true" className="size-5" />
            {t("group.add")}
          </Link>
        </div>
        {tabs.map((tab) => {
          if (tab.value === "expenses") {
            return (
              <Tabs.Content key={tab.value} value={tab.value} className="pt-4 pb-6 text-ink-muted">
                <ExpenseList groupId={group.id} settlementCurrency={group.settlementCurrency} />
              </Tabs.Content>
            );
          }
          if (tab.value === "trip") {
            return (
              <Tabs.Content key={tab.value} value={tab.value} className="pt-4 pb-6">
                <TripPanel group={group} />
              </Tabs.Content>
            );
          }
          if (tab.value === "settle") {
            return (
              <Tabs.Content key={tab.value} value={tab.value} className="pt-4 pb-6 text-ink-muted">
                <SettlePanel group={group} />
              </Tabs.Content>
            );
          }
          return (
            <Tabs.Content key={tab.value} value={tab.value} className="pt-4 pb-6 text-ink-muted">
              {t("page.comingSoon")}
            </Tabs.Content>
          );
        })}
      </Tabs.Root>
    </div>
  );
}
