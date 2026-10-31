import * as Tabs from "@radix-ui/react-tabs";
import type { Group } from "@split/shared";
import { Plane, Plus, Trash2, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { ExpenseList } from "../expenses/ExpenseList.js";
import { ExpenseSavedToast } from "../expenses/ExpenseSavedToast.js";
import type { SavedShare } from "../expenses/expense-sharing.js";
import { useGroup } from "../groups/api.js";
import { DeleteGroupDialog } from "../groups/DeleteGroupDialog.js";
import { LoadError, Loading, MaintenanceTag, ScreenHeader } from "../groups/ui.js";
import { type MessageId, t } from "../i18n/messages.js";
import { SelectionPill } from "../shell/SelectionPill.js";
import { SproutMascot } from "../shell/SproutMascot.js";
import { SettlePanel } from "../settlements/SettlePanel.js";
import { TRIP_ENABLED } from "../trip/enabled.js";
import { TripPanel } from "../trip/TripPanel.js";

/**
 * Screen 3 as amended: the same tabs everywhere, 帳目, 行程 (Trips only) and 結算, with the
 * Admin-only menu holding the delete action. The tab contents arrive with the Expense, Trip and
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
  // The note after saving an Expense arrives in router state; keep it, then drop it from the
  // history entry so a reload does not show it again. `newExpenseId` stays for the highlight.
  const location = useLocation();
  const navigate = useNavigate();
  const arrived = location.state as { newExpenseId?: string; share?: SavedShare } | null;
  const [saved] = useState(arrived?.share);
  useEffect(() => {
    if (arrived?.share === undefined) return;
    void navigate(
      { pathname: location.pathname, search: location.search },
      { replace: true, state: { newExpenseId: arrived.newExpenseId } },
    );
  }, [arrived, location.pathname, location.search, navigate]);
  const [activeTab, setActiveTab] = useState(
    tabs.some((tab) => tab.value === asked) ? asked : "expenses",
  );
  return (
    <div className="flex flex-col gap-3">
      {saved !== undefined && <ExpenseSavedToast saved={saved} />}
      <ScreenHeader
        compact
        centered
        title={group.name}
        back="/groups"
        action={<GroupActions group={group} />}
        subtitle={
          group.isTrip ? (
            <span className="flex flex-wrap items-center justify-center gap-3">
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
          <span className="sprout-greet inline-flex">
            <SproutMascot className="size-14" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-bold">{t("group.alone.title")}</h2>
            <p className="text-sm text-ink-muted">{t("group.alone.body")}</p>
          </div>
          <Link
            to={`/groups/${group.id}/members`}
            className="press-pill shrink-0 rounded-full bg-sprout-500 px-4 py-2 text-sm font-bold text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25)] hover:bg-sprout-500/90"
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
            className="press-pill flex shrink-0 items-center gap-1 rounded-full bg-sprout-500 px-4 py-3 font-bold text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_4px_12px_-6px_#143f2a] hover:bg-sprout-500/90"
          >
            <Plus aria-hidden="true" className="size-5" />
            {t("group.add")}
          </Link>
        </div>
        {tabs.map((tab) => {
          if (tab.value === "expenses") {
            return (
              <Tabs.Content
                key={tab.value}
                value={tab.value}
                className="tab-panel pt-3 pb-6 text-ink-muted"
              >
                <ExpenseList groupId={group.id} settlementCurrency={group.settlementCurrency} />
              </Tabs.Content>
            );
          }
          if (tab.value === "trip") {
            return (
              <Tabs.Content key={tab.value} value={tab.value} className="tab-panel pt-3 pb-6">
                <TripPanel group={group} />
              </Tabs.Content>
            );
          }
          if (tab.value === "settle") {
            return (
              <Tabs.Content
                key={tab.value}
                value={tab.value}
                className="tab-panel pt-3 pb-6 text-ink-muted"
              >
                <SettlePanel group={group} />
              </Tabs.Content>
            );
          }
          return (
            <Tabs.Content
              key={tab.value}
              value={tab.value}
              className="tab-panel pt-4 pb-6 text-ink-muted"
            >
              {t("page.comingSoon")}
            </Tabs.Content>
          );
        })}
      </Tabs.Root>
    </div>
  );
}

/** Icon-only header controls: the members and invite page, and (Admins) delete the Group. */
function GroupActions({ group }: { group: Group }) {
  const [deleting, setDeleting] = useState(false);
  const alone = group.memberCount === 1;
  return (
    <span className="flex items-center">
      <Link
        to={`/groups/${group.id}/members`}
        aria-label={
          alone ? t("group.aloneShort") : t("group.summary", { count: group.memberCount })
        }
        className="press-icon relative flex size-11 items-center justify-center rounded-full text-sprout-700 hover:bg-sprout-150"
      >
        {alone && (
          <span
            aria-hidden="true"
            className="invite-pulse absolute inset-1.5 rounded-full bg-sprout-500/30"
          />
        )}
        <UserPlus aria-hidden="true" className="relative size-6" />
        <span
          aria-hidden="true"
          className="absolute top-1 right-0.5 flex min-w-4 items-center justify-center rounded-full bg-sprout-600 px-1 text-[0.625rem] leading-4 font-bold text-white"
        >
          {group.memberCount}
        </span>
      </Link>
      {group.me.role === "admin" && (
        <>
          <button
            type="button"
            aria-label={t("group.delete")}
            onClick={() => {
              setDeleting(true);
            }}
            className="press-icon flex size-11 items-center justify-center rounded-full text-red-700 hover:bg-red-50"
          >
            <Trash2 aria-hidden="true" className="size-6" />
          </button>
          <DeleteGroupDialog group={group} open={deleting} onOpenChange={setDeleting} />
        </>
      )}
    </span>
  );
}
