import { ChevronRight } from "lucide-react";
import { Link, Navigate } from "react-router";
import { useGroups } from "../groups/api.js";
import { card, LoadError, Loading, primaryButton, ScreenHeader } from "../groups/ui.js";
import { t } from "../i18n/messages.js";

/** ＋記一筆: pick the Group (screen 4's 選擇群組), or go straight there when there is one. */
export function NewEntryPage() {
  const groups = useGroups();
  if (groups.isError)
    return <LoadError error={groups.error} onRetry={() => void groups.refetch()} />;
  if (groups.isPending) return <Loading />;
  const [only] = groups.data;
  if (groups.data.length === 1 && only !== undefined) {
    return <Navigate to={`/groups/${only.id}/expenses/new`} replace />;
  }
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <ScreenHeader title={t("expense.chooseGroup")} />
      {groups.data.length === 0 ? (
        <>
          <p className="text-ink-muted">{t("expense.noGroups")}</p>
          <Link to="/groups/new" className={`${primaryButton} py-3`}>
            {t("groups.create")}
          </Link>
        </>
      ) : (
        <ul className="flex flex-col gap-2">
          {groups.data.map((g) => (
            <li key={g.id}>
              <Link
                to={`/groups/${g.id}/expenses/new`}
                className={`${card} flex items-center gap-3 px-5 py-4 font-bold hover:border-sprout-500`}
              >
                <span className="flex-1 truncate">{g.name}</span>
                <ChevronRight aria-hidden="true" className="size-5 text-ink-muted" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
