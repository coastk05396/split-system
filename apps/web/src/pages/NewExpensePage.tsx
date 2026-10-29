import { useNavigate, useParams } from "react-router";
import { ExpenseForm } from "../expenses/ExpenseForm.js";
import { useGroup, useMembers } from "../groups/api.js";
import { LoadError, Loading, ScreenHeader } from "../groups/ui.js";
import { t } from "../i18n/messages.js";

/** Screen 4: add an Expense to one Group, then back to that Group's list. */
export function NewExpensePage() {
  const id = useParams().id ?? "";
  const navigate = useNavigate();
  const group = useGroup(id);
  const members = useMembers(id);
  if (group.isError) return <LoadError error={group.error} onRetry={() => void group.refetch()} />;
  if (members.isError) {
    return <LoadError error={members.error} onRetry={() => void members.refetch()} />;
  }
  if (group.isPending || members.isPending) return <Loading />;
  return (
    <div className="flex max-w-2xl flex-col">
      <ScreenHeader title={t("expense.new")} back={`/groups/${id}`} subtitle={group.data.name} />
      <ExpenseForm
        group={group.data}
        members={members.data}
        onSaved={() => void navigate(`/groups/${id}`)}
      />
    </div>
  );
}
