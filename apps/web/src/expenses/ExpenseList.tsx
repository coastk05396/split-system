import { type CurrencyCode, type Expense, formatAmount, type Member } from "@split/shared";
import { Link, useLocation } from "react-router";
import { useMembers } from "../groups/api.js";
import { card, LoadError, Loading, secondaryButton } from "../groups/ui.js";
import { longDate } from "../i18n/format.js";
import { localName } from "../i18n/format.js";
import { t } from "../i18n/messages.js";
import { useExpenses } from "./api.js";
import { CategoryIcon } from "./CategoryIcon.js";

export function memberPictures(
  members: readonly Member[] | undefined,
): (id: string) => string | null {
  const pictures = new Map((members ?? []).map((m) => [m.id, m.pictureUrl]));
  return (id) => pictures.get(id) ?? null;
}

export function memberNames(members: readonly Member[] | undefined): (id: string) => string {
  const names = new Map((members ?? []).map((m) => [m.id, localName(m.displayName)]));
  return (id) => names.get(id) ?? "?";
}

/** The Expenses of each day, the latest day first and the latest time first within a day. */
function groupByDate(rows: readonly Expense[]): { date: string; items: Expense[] }[] {
  const days = new Map<string, Expense[]>();
  for (const e of rows) days.set(e.expenseDate, [...(days.get(e.expenseDate) ?? []), e]);
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([date, items]) => ({
      date,
      // Array#sort is stable: untimed or same-time Expenses keep the Worker's newest-first order.
      items: [...items].sort((a, b) => (b.expenseTime ?? "").localeCompare(a.expenseTime ?? "")),
    }));
}

export const dateHeading = longDate;

/** The 帳目 tab: grouped by day, newest day first, 50 a page, each row opening the Expense's detail. */
export function ExpenseList({
  groupId,
  settlementCurrency,
}: {
  groupId: string;
  settlementCurrency: CurrencyCode;
}) {
  const expenses = useExpenses(groupId);
  // Coming back from saving one: that row drops in and glows once.
  const freshId = (useLocation().state as { newExpenseId?: string } | null)?.newExpenseId;
  const members = useMembers(groupId);
  const nameOf = memberNames(members.data);
  if (expenses.isError) {
    return <LoadError error={expenses.error} onRetry={() => void expenses.refetch()} />;
  }
  if (expenses.isPending) return <Loading />;
  const rows = expenses.data.pages.flatMap((p) => p.expenses);
  return (
    <section aria-label={t("expense.list")} className="flex flex-col gap-4">
      {rows.length === 0 ? (
        <p className="py-4 text-center text-ink-muted">{t("expense.empty")}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {groupByDate(rows).map((day) => (
            <section
              key={day.date}
              aria-label={dateHeading(day.date)}
              className="flex flex-col gap-2"
            >
              <h3 className="rounded-xl bg-sprout-150 px-4 py-1.5 text-sm font-bold text-ink-muted">
                {dateHeading(day.date)}
              </h3>
              <ul className="flex flex-col gap-2">
                {day.items.map((e) => (
                  <li key={e.id} className={e.id === freshId ? "row-arrive" : undefined}>
                    <ExpenseRow
                      groupId={groupId}
                      expense={e}
                      nameOf={nameOf}
                      settlementCurrency={settlementCurrency}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
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
  settlementCurrency,
}: {
  groupId: string;
  expense: Expense;
  nameOf: (id: string) => string;
  settlementCurrency: CurrencyCode;
}) {
  // Each payer with what they put in, in the Expense currency: "A 先付 NT$ 60、B 先付 NT$ 40".
  const payers = expense.payers
    .map((p) =>
      t("expense.paidByLine", {
        name: nameOf(p.memberId),
        amount: formatAmount(p.amountMinor, expense.originalCurrency),
      }),
    )
    .join("、");
  return (
    <Link
      to={`/groups/${groupId}/expenses/${expense.id}`}
      className={`${card} flex items-center gap-3 px-4 py-3 text-ink hover:border-sprout-500`}
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-sprout-100 text-sprout-600">
        <CategoryIcon category={expense.category} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-bold">{expense.description}</span>
        <span className="truncate text-sm text-ink-muted">{payers}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end">
        <span className="font-bold text-sprout-700">
          {formatAmount(expense.originalAmount, expense.originalCurrency)}
        </span>
        {expense.originalCurrency !== settlementCurrency && (
          <span className="text-xs text-ink-muted">
            {t("expense.settledAs", {
              amount: formatAmount(expense.settlementAmount, settlementCurrency),
            })}
          </span>
        )}
      </span>
    </Link>
  );
}
