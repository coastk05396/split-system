import { useNavigate, useParams } from "react-router";
import { useExpense } from "../expenses/api.js";
import { ExpenseForm } from "../expenses/ExpenseForm.js";
import { useGroup, useMembers } from "../groups/api.js";
import { LoadError, Loading, ScreenHeader } from "../groups/ui.js";
import { t } from "../i18n/messages.js";
import { useSettlements } from "../settlements/api.js";

/** Edit an Expense under If-Match; a clash answers EDIT_CONFLICT. */
export function EditExpensePage() {
  const params = useParams();
  const id = params.id ?? "";
  const eid = params.eid ?? "";
  const navigate = useNavigate();
  const group = useGroup(id);
  const members = useMembers(id);
  const expense = useExpense(id, eid);
  const settlements = useSettlements(id);
  const failed = [group, members, expense].find((q) => q.isError);
  if (failed !== undefined) {
    return <LoadError error={failed.error} onRetry={() => void failed.refetch()} />;
  }
  if (!group.isSuccess || !members.isSuccess || !expense.isSuccess) return <Loading />;
  const hasSettlements =
    settlements.data?.pages.some((page) => page.settlements.length > 0) ?? false;
  const back = `/groups/${id}/expenses/${eid}`;
  return (
    <div className="flex max-w-2xl flex-col">
      <ScreenHeader title={t("expense.edit")} back={back} subtitle={group.data.name} />
      {hasSettlements && (
        <div
          role="alert"
          className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-900"
        >
          {t("expense.hasSettlementsWarning")}
        </div>
      )}
      <ExpenseForm
        group={group.data}
        members={members.data}
        expense={expense.data}
        onSaved={() => void navigate(back)}
      />
    </div>
  );
}
