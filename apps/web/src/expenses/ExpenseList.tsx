import { type Expense, formatAmount, type Member } from "@split/shared";
import { Plus } from "lucide-react";
import { Link } from "react-router";
import { useMembers } from "../groups/api.js";
import { card, LoadError, Loading, primaryButton, secondaryButton } from "../groups/ui.js";
import { t } from "../i18n/messages.js";
import { useExpenses } from "./api.js";

export function memberNames(members: readonly Member[] | undefined): (id: string) => string {
  const names = new Map((members ?? []).map((m) => [m.id, m.displayName]));
  return (id) => names.get(id) ?? "?";
}

/** The 帳目 tab: newest first, 50 a page, each row opening the Expense's detail. */
export function ExpenseList({ groupId }: { groupId: string }) {
  const expenses = useExpenses(groupId);
  const members = useMembers(groupId);
  const nameOf = memberNames(members.data);
  const newLink = (
    <Link to={`/groups/${groupId}/expenses/new`} className={`${primaryButton} py-3`}>
      <Plus aria-hidden="true" className="size-5" />
      {t("expense.new")}
    </Link>
  );
  if (expenses.isError) {
    return <LoadError error={expenses.error} onRetry={() => void expenses.refetch()} />;
  }
  if (expenses.isPending) return <Loading />;
  const rows = expenses.data.pages.flatMap((p) => p.expenses);
  return (
    <section aria-label={t("expense.list")} className="flex flex-col gap-4">
      {newLink}
      {rows.length === 0 ? (
        <p className="py-4 text-center text-ink-muted">{t("expense.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((e) => (
            <li key={e.id}>
              <ExpenseRow groupId={groupId} expense={e} nameOf={nameOf} />
            </li>
          ))}
        </ul>
      )}
      {expenses.hasNextPage && (
        <button
          type="button"
          className={`${secondaryButton} py-3`}
          disabled={expenses.isFetchingNextPage}
          onClick={() => void expenses.fetchNextPage()}
        >
          {t("expense.more")}
        </button>
      )}
    </section>
  );
}

function ExpenseRow({
  groupId,
  expense,
  nameOf,
}: {
  groupId: string;
  expense: Expense;
  nameOf: (id: string) => string;
}) {
  const payers = expense.payers.map((p) => nameOf(p.memberId)).join("、");
  return (
    <Link
      to={`/groups/${groupId}/expenses/${expense.id}`}
      className={`${card} flex items-center gap-3 px-4 py-3 text-ink hover:border-sprout-500`}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-bold">{expense.description}</span>
        <span className="truncate text-sm text-ink-muted">
          {expense.category} · {expense.expenseDate.replaceAll("-", "/")}
          {expense.expenseTime === null ? "" : ` ${expense.expenseTime}`} ·{" "}
          {t("expense.paidByLine", { names: payers })}
        </span>
      </span>
      <span className="font-bold text-sprout-700">
        {formatAmount(expense.originalAmount, expense.originalCurrency)}
      </span>
    </Link>
  );
}
