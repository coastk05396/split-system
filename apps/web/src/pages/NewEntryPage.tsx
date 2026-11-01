import { ChevronRight, Plus } from "lucide-react";
import { Link, Navigate, useSearchParams } from "react-router";
import { useGroups } from "../groups/api.js";
import { GroupAvatar, LoadError, Loading, primaryButton, ScreenHeader } from "../groups/ui.js";
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
          {groups.data.map((g) => (
            <li key={g.id}>
              <PressableLink
                to={`/groups/${g.id}/expenses/new`}
                className="surface-card group flex items-center gap-4 rounded-3xl border border-sprout-200 bg-white p-4 hover:border-sprout-400 hover:-translate-y-0.5 hover:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.95),0_12px_24px_-12px_rgba(20,63,42,0.15)] active:translate-y-0 active:scale-[0.98] transition-all duration-200 ease-(--ease-spring) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sprout-600"
              >
                <GroupAvatar
                  name={g.name}
                  groupId={g.id}
                  className="size-12 text-base font-bold shadow-[inset_0_1px_0_0_rgb(255_255_255/0.8)]"
                  interactive={true}
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-lg font-bold">{g.name}</span>
                  <span className="text-xs text-ink-muted">
                    {t("groups.people", { count: g.memberCount })}
                    <span className="mx-1.5 opacity-60">·</span>
                    <span className="font-semibold text-sprout-700">
                      {t(g.isTrip ? "usage.trip" : "usage.tab")}
                    </span>
                  </span>
                </span>
                <ChevronRight
                  aria-hidden="true"
                  className="size-5 shrink-0 text-ink-muted transition-transform duration-180 ease-(--ease-out-expo) group-hover:translate-x-1 group-hover:text-sprout-700 motion-reduce:group-hover:translate-x-0"
                />
              </PressableLink>
            </li>
          ))}
        </ul>
      )}
      {groups.data.length > 0 && (
        <Link
          to="/groups/new?usage=tab"
          className="press-pill flex items-center justify-center gap-2 rounded-2xl bg-sprout-600 px-6 py-4 font-bold text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_18px_-8px_#143f2a] hover:bg-sprout-700 active:bg-sprout-800 active:scale-[0.98] transition-all duration-180 ease-(--ease-spring) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sprout-600"
        >
          <Plus aria-hidden="true" className="size-5" />
          {t("groups.create")}
        </Link>
      )}
    </div>
  );
}
