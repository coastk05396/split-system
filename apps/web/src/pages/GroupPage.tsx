import * as Tabs from "@radix-ui/react-tabs";
import type { Group } from "@split/shared";
import { Plane, UserPlus, Users } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router";
import { ExpenseList } from "../expenses/ExpenseList.js";
import { useGroup } from "../groups/api.js";
import { DeleteGroupDialog } from "../groups/DeleteGroupDialog.js";
import { LoadError, Loading, primaryButton, ScreenHeader, secondaryButton } from "../groups/ui.js";
import { type MessageId, t } from "../i18n/messages.js";
import { SettlePanel } from "../settlements/SettlePanel.js";

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
  // `?tab=settle` opens a tab directly, as after recording a 轉帳.
  const [params] = useSearchParams();
  const tabs: { value: string; label: MessageId }[] = [
    { value: "expenses", label: "group.tab.expenses" },
    ...(group.isTrip ? [{ value: "trip", label: "group.tab.trip" } as const] : []),
    { value: "settle", label: "group.tab.settle" },
  ];
  return (
    <div className="flex flex-col gap-6">
      <ScreenHeader
        title={group.name}
        back="/groups"
        action={group.me.role === "admin" ? <DeleteGroupDialog group={group} /> : undefined}
        subtitle={
          <span className="flex flex-wrap items-center gap-3">
            {t("group.summary", { count: group.memberCount })}
            {group.isTrip && (
              <span className="flex items-center gap-1 rounded-full bg-peach px-3 py-1 text-xs font-bold text-sprout-700">
                <Plane aria-hidden="true" className="size-3.5" />
                {t("group.tripBadge")}
              </span>
            )}
          </span>
        }
      />
      <div className="flex gap-3">
        <Link to={`/groups/${group.id}/members`} className={`${secondaryButton} flex-1 py-3`}>
          <Users aria-hidden="true" className="size-5" />
          {t("group.members")}
        </Link>
        <Link to={`/groups/${group.id}/invite`} className={`${secondaryButton} flex-1 py-3`}>
          <UserPlus aria-hidden="true" className="size-5" />
          {t("group.invite")}
        </Link>
      </div>
      {group.memberCount === 1 && (
        <section className="flex flex-col items-center gap-3 rounded-3xl bg-sprout-150 p-6 text-center">
          <h2 className="text-lg font-bold">{t("group.alone.title")}</h2>
          <p className="text-sm text-ink-muted">{t("group.alone.body")}</p>
          <Link to={`/groups/${group.id}/invite`} className={`${primaryButton} py-3`}>
            {t("group.alone.invite")}
          </Link>
        </section>
      )}
      <Tabs.Root
        defaultValue={tabs.some((x) => x.value === params.get("tab")) ? (params.get("tab") ?? "") : "expenses"}
      >
        <Tabs.List
          aria-label={t("group.tabs")}
          className="flex gap-1 rounded-2xl bg-sprout-150 p-1"
        >
          {tabs.map((tab) => (
            <Tabs.Trigger
              key={tab.value}
              value={tab.value}
              className="flex-1 rounded-xl py-2.5 text-ink-muted data-[state=active]:bg-white data-[state=active]:font-bold data-[state=active]:text-ink"
            >
              {t(tab.label)}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        {tabs.map((tab) => (
          <Tabs.Content key={tab.value} value={tab.value} className="py-6 text-ink-muted">
            {tab.value === "expenses" ? (
              <ExpenseList groupId={group.id} />
            ) : tab.value === "settle" ? (
              <SettlePanel group={group} />
            ) : (
              t("page.comingSoon")
            )}
          </Tabs.Content>
        ))}
      </Tabs.Root>
    </div>
  );
}
