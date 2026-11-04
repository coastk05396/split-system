import { type CurrencyCode, type Expense, formatAmount, type Member } from "@split/shared";
import { useAuth } from "../auth/AuthProvider.js";
import { PressableLink } from "../shell/PressableLink.js";
import { useMembers } from "../groups/api.js";
import { card, LoadError, Loading, secondaryButton } from "../groups/ui.js";
import { longDate } from "../i18n/format.js";
import { localName } from "../i18n/format.js";
import { t } from "../i18n/messages.js";
import { SproutMascot } from "../shell/SproutMascot.js";
import { useExpenses } from "./api.js";
import {
  type PendingSave,
  removeSave,
  useJustSaved,
  usePendingDeletes,
  usePendingSaves,
} from "./pending-writes.js";
import { CategoryIcon, categoryTone } from "./CategoryIcon.js";

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
  myMemberId,
}: {
  groupId: string;
  settlementCurrency: CurrencyCode;
  myMemberId?: string;
}) {
  const auth = useAuth();
  const expenses = useExpenses(groupId);
  const deleting = usePendingDeletes(groupId);
  const saving = usePendingSaves(groupId);
  // Coming back from saving one: that row drops in and glows once.
  const freshId = useJustSaved(groupId);
  const members = useMembers(groupId);
  const nameOf = memberNames(members.data);

  const currentUserId = auth.state.status === "signedIn" ? auth.state.user.id : null;
  const resolvedMyMemberId =
    myMemberId ??
    (currentUserId !== null
      ? members.data?.find((m) => m.userId === currentUserId)?.id
      : undefined);

  if (expenses.isError) {
    return <LoadError error={expenses.error} onRetry={() => void expenses.refetch()} />;
  }
  if (expenses.isPending) return <Loading />;
  // Totals stay on what the server has confirmed; only the rows hide while a delete is pending.
  const confirmed = expenses.data.pages.flatMap((p) => p.expenses);
  const rows = confirmed.filter((e) => !deleting.includes(e.id));

  const totalSettlement = confirmed.reduce((sum, e) => sum + e.settlementAmount, 0);
  const myShare = resolvedMyMemberId
    ? confirmed.reduce((sum, e) => {
        const split = e.splits.find((s) => s.memberId === resolvedMyMemberId);
        return sum + (split?.settlementAmount ?? 0);
      }, 0)
    : 0;

  const editing = new Set(saving.flatMap((s) => (s.expenseId === null ? [] : [s.expenseId])));
  return (
    <section aria-label={t("expense.list")} className="flex flex-col gap-4">
      {saving.length > 0 && (
        <ul className="flex flex-col gap-2">
          {saving.map((s) => (
            <li key={s.key}>
              <PendingRow save={s} />
            </li>
          ))}
        </ul>
      )}
      {rows.length === 0 && saving.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
          <span className="sprout-greet inline-flex">
            <SproutMascot className="size-20" mood="happy" interactive={true} />
          </span>
          <p className="text-sm font-medium text-ink-muted">{t("expense.empty")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-center pt-0.5 pb-1">
            <span className="inline-flex items-center rounded-full border border-sprout-200/70 bg-sprout-100/90 px-3.5 py-1 text-xs font-medium text-sprout-800 shadow-2xs">
              {t("expense.overviewCapsule", {
                total: formatAmount(totalSettlement, settlementCurrency),
                share: formatAmount(myShare, settlementCurrency),
              })}
            </span>
          </div>
          {groupByDate(rows.filter((e) => !editing.has(e.id))).map((day) => (
            <section
              key={day.date}
              aria-label={dateHeading(day.date)}
              className="flex flex-col gap-2"
            >
              <h3 className="rounded-xl bg-sprout-150 px-4 py-1.5 text-sm font-bold text-ink-muted">
                {dateHeading(day.date)}
              </h3>
              <ul className="flex flex-col gap-2">
                {day.items.map((e, itemIndex) => {
                  const globalIndex = rows.findIndex((r) => r.id === e.id);
                  const delay = (globalIndex >= 0 ? globalIndex : itemIndex) * 35;
                  return (
                    <li
                      key={e.id}
                      className={`list-stagger-item ${e.id === freshId ? "row-arrive" : ""}`}
                      style={{ animationDelay: `${delay}ms` }}
                    >
                      <ExpenseRow
                        groupId={groupId}
                        expense={e}
                        nameOf={nameOf}
                        settlementCurrency={settlementCurrency}
                      />
                    </li>
                  );
                })}
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

/** A save the server has not answered: a muted row, with a retry when it failed. */
export function PendingRow({ save }: { save: PendingSave }) {
  const failed = save.status === "failed";
  return (
    <div
      className={`${card} flex items-center gap-3 px-4 py-3 ${failed ? "border-red-300" : "opacity-70"}`}
    >
      <span
        className={`flex size-11 shrink-0 items-center justify-center rounded-2xl border ${categoryTone(save.category).badge}`}
      >
        <CategoryIcon category={save.category} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-bold">{save.description}</span>
        {failed ? (
          <span role="alert" className="text-xs font-bold text-red-700">
            {t("expense.saveFailed", { reason: save.error ?? "" })}
          </span>
        ) : (
          <span className="text-xs text-ink-muted">{t("expense.saving")}</span>
        )}
      </span>
      <span className="flex shrink-0 flex-col items-end">
        <span className="font-bold text-sprout-700">
          {formatAmount(save.amount, save.currency)}
        </span>
        {failed && (
          <span className="flex gap-2 text-xs font-bold">
            <button type="button" className="min-h-11 px-2" onClick={save.retry}>
              {t("expense.saveRetry")}
            </button>
            <button
              type="button"
              className="min-h-11 px-2"
              onClick={() => {
                removeSave(save.key);
              }}
            >
              {t("expense.saveDiscard")}
            </button>
          </span>
        )}
      </span>
    </div>
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
    <PressableLink
      to={`/groups/${groupId}/expenses/${expense.id}`}
      className={`${card} group flex items-center gap-3 px-4 py-3 text-ink hover:border-sprout-500 active:bg-sprout-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sprout-600`}
    >
      <span
        className={`flex size-11 shrink-0 items-center justify-center rounded-2xl border shadow-[inset_0_1.5px_1px_0_rgba(255,255,255,0.9),0_2px_6px_-1px_rgba(20,63,42,0.08)] transition-transform duration-300 ease-(--ease-spring) group-hover:scale-105 group-active:scale-[1.08] motion-reduce:transform-none ${categoryTone(expense.category).badge}`}
      >
        <CategoryIcon category={expense.category} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-bold">{expense.description}</span>
        <span className="truncate text-xs text-ink-muted">{payers}</span>
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
    </PressableLink>
  );
}
