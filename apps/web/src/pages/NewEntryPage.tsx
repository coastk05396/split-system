import { ChevronRight, House, Plane, Plus } from "lucide-react";
import { Link, Navigate, useSearchParams } from "react-router";
import { useGroups } from "../groups/api.js";
import { card, LoadError, Loading, primaryButton, ScreenHeader } from "../groups/ui.js";
import { SproutMark } from "../shell/SproutMark.js";
import { PressableLink } from "../shell/PressableLink.js";
import { t } from "../i18n/messages.js";

/**
 * ＋記一筆: pick the Group (screen 4's 選擇群組), or go straight there when there is one. From
 * Home's 快速分帳 (`?pick=1`) the list always shows, so a new Group can be started from it.
 */
export function NewEntryPage() {
  const groups = useGroups();
  const pick = useSearchParams()[0].get("pick") === "1";
  if (groups.isError)
    return <LoadError error={groups.error} onRetry={() => void groups.refetch()} />;
  if (groups.isPending) return <Loading />;
  const [only] = groups.data;
  if (!pick && groups.data.length === 1 && only !== undefined) {
    return <Navigate to={`/groups/${only.id}/expenses/new`} replace />;
  }
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <ScreenHeader
        title={t("expense.chooseGroup")}
        subtitle={t("expense.chooseHint")}
        action={<SproutMark className="size-14" />}
      />
      {groups.data.length === 0 ? (
        <>
          <p className="text-ink-muted">{t("expense.noGroups")}</p>
          <Link to="/groups/new" className={`${primaryButton} py-3`}>
            {t("groups.create")}
          </Link>
        </>
      ) : (
        <ul className="flex flex-col gap-3">
          {groups.data.map((g) => {
            const Icon = g.isTrip ? Plane : House;
            return (
              <li key={g.id}>
                <PressableLink
                  to={`/groups/${g.id}/expenses/new`}
                  className={`${card} group flex items-center gap-4 p-4 transition-[border-color,background-color,box-shadow] hover:border-sprout-500 hover:shadow-[0_8px_20px_-15px_#143f2a] active:bg-sprout-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sprout-600`}
                >
                  <span
                    className={`flex size-12 shrink-0 items-center justify-center rounded-2xl ${
                      g.isTrip ? "bg-sprout-100" : "bg-peach"
                    }`}
                  >
                    <Icon aria-hidden="true" className="size-6 text-sprout-500" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-lg font-bold">{g.name}</span>
                    <span className="text-sm text-ink-muted">
                      {t("groups.people", { count: g.memberCount })}
                      {" · "}
                      {t(g.isTrip ? "usage.trip" : "usage.tab")}
                    </span>
                  </span>
                  <ChevronRight aria-hidden="true" className="size-5 text-ink-muted" />
                </PressableLink>
              </li>
            );
          })}
        </ul>
      )}
      {groups.data.length > 0 && (
        <Link
          to="/groups/new?usage=tab"
          className="flex items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-sprout-500 bg-peach/40 px-6 py-4 font-bold text-sprout-700 hover:bg-peach/70"
        >
          <Plus aria-hidden="true" className="size-5" />
          {t("groups.create")}
        </Link>
      )}
    </div>
  );
}
