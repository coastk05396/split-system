import { ArrowRight, ChevronRight, Plus } from "lucide-react";
import { Link, Navigate, useSearchParams } from "react-router";
import { useGroups } from "../groups/api.js";
import { AvatarStack } from "../groups/AvatarStack.js";
import { GroupAvatar, LoadError, Loading, MaintenanceTag, primaryButton } from "../groups/ui.js";
import { PressableLink } from "../shell/PressableLink.js";
import { t } from "../i18n/messages.js";
import { TRIP_ENABLED } from "../trip/enabled.js";

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
    <div className="flex flex-col gap-4 md:gap-6">
      <header>
        <h1 className="text-2xl font-bold md:text-3xl">{t("expense.chooseGroup")}</h1>
      </header>
      {groups.data.length === 0 ? (
        <>
          <p className="text-ink-muted">{t("expense.noGroups")}</p>
          <Link to="/groups/new" className={`${primaryButton} justify-between`}>
            <span className="flex items-center gap-2">
              <Plus aria-hidden="true" className="size-5" />
              {t("groups.create")}
            </span>
            <ArrowRight aria-hidden="true" className="size-5" />
          </Link>
        </>
      ) : (
        <ul aria-label={t("expense.chooseGroup")} className="grid gap-2.5 md:grid-cols-2 md:gap-4">
          {groups.data.map((g, index) => (
            <li
              key={g.id}
              className="list-stagger-item"
              style={{ animationDelay: `${index * 40}ms` }}
            >
              <PressableLink
                to={`/groups/${g.id}/expenses/new`}
                className="surface-card group flex items-center justify-between gap-3.5 rounded-2xl border border-sprout-200/80 bg-white p-4 shadow-2xs hover:border-sprout-300 press-card text-ink focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-sprout-600"
              >
                <div className="flex min-w-0 items-center gap-3.5">
                  <GroupAvatar
                    name={g.name}
                    groupId={g.id}
                    className="size-11 shrink-0 text-base transition-transform duration-300 ease-(--ease-spring) group-hover:scale-105 group-hover:rotate-2 group-active:scale-95 group-active:-rotate-2 md:size-12 md:text-lg motion-reduce:transform-none"
                  />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-base font-bold text-ink">{g.name}</span>
                      {g.isTrip && !TRIP_ENABLED && <MaintenanceTag />}
                    </div>
                    <span className="text-xs text-ink-muted">
                      {t("groups.memberCount", { count: g.memberCount })}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2.5">
                  <AvatarStack members={g.memberPreview} total={g.memberCount} />
                  <ChevronRight
                    aria-hidden="true"
                    className="size-5 shrink-0 text-ink-muted transition-transform duration-180 ease-(--ease-out-expo) group-hover:translate-x-1 motion-reduce:group-hover:translate-x-0"
                  />
                </div>
              </PressableLink>
            </li>
          ))}
        </ul>
      )}
      {groups.data.length > 0 && (
        <Link to="/groups/new?usage=tab" className={`${primaryButton} justify-between`}>
          <span className="flex items-center gap-2">
            <Plus aria-hidden="true" className="size-5" />
            {t("groups.create")}
          </span>
          <ArrowRight aria-hidden="true" className="size-5" />
        </Link>
      )}
    </div>
  );
}
