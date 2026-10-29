import { useNavigate, useParams } from "react-router";
import { ExpenseForm } from "../expenses/ExpenseForm.js";
import { useExpenses } from "../expenses/api.js";
import { useGroup, useMembers } from "../groups/api.js";
import { LoadError, Loading, ScreenHeader } from "../groups/ui.js";
import { t } from "../i18n/messages.js";

/**
 * Screen 4: add an Expense to one Group, then back to that Group's list. The currency starts
 * at the one the Group's latest Expense used, so a run of dollars abroad needs no switching.
 */
export function NewExpensePage() {
  const id = useParams().id ?? "";
  const navigate = useNavigate();
  const group = useGroup(id);
  const members = useMembers(id);
  const expenses = useExpenses(id);
  if (group.isError) return <LoadError error={group.error} onRetry={() => void group.refetch()} />;
  if (members.isError) {
    return <LoadError error={members.error} onRetry={() => void members.refetch()} />;
  }
  // A failed expense list only costs the shortcut: the form then starts at the Settlement currency.
  if (group.isPending || members.isPending || expenses.isPending) return <Loading />;
  const startCurrency = expenses.data?.pages[0]?.expenses[0]?.originalCurrency;
  return (
    <div className="flex max-w-2xl flex-col">
      <ScreenHeader title={t("expense.new")} back={`/groups/${id}`} subtitle={group.data.name} />
      <ExpenseForm
        group={group.data}
        members={members.data}
        {...(startCurrency === undefined ? {} : { startCurrency })}
        onSaved={() => void navigate(`/groups/${id}`)}
      />
    </div>
  );
}
