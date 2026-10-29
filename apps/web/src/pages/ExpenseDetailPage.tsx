import * as Dialog from "@radix-ui/react-dialog";
import { type Expense, formatAmount, formatRate, type Group } from "@split/shared";
import { Pencil, Trash2 } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { useDeleteExpense, useExpense } from "../expenses/api.js";
import { memberNames } from "../expenses/ExpenseList.js";
import { useGroup, useMembers } from "../groups/api.js";
import {
  Avatar,
  card,
  failureMessage,
  LoadError,
  Loading,
  primaryButton,
  ScreenHeader,
  secondaryButton,
} from "../groups/ui.js";
import { t } from "../i18n/messages.js";

/**
 * Screen 10 as amended: original amount and currency, the rate with its date and edited flag,
 * the converted amount, payers and split lines; edit and delete for the creator or an Admin.
 */
export function ExpenseDetailPage() {
  const params = useParams();
  const id = params.id ?? "";
  const eid = params.eid ?? "";
  const group = useGroup(id);
  const members = useMembers(id);
  const expense = useExpense(id, eid);
  const failed = [group, members, expense].find((q) => q.isError);
  if (failed !== undefined) {
    return <LoadError error={failed.error} onRetry={() => void failed.refetch()} />;
  }
  if (!group.isSuccess || !members.isSuccess || !expense.isSuccess) return <Loading />;
  const nameOf = memberNames(members.data);
  return <Detail group={group.data} expense={expense.data} nameOf={nameOf} />;
}

function Detail({
  group,
  expense,
  nameOf,
}: {
  group: Group;
  expense: Expense;
  nameOf: (id: string) => string;
}) {
  const canChange = expense.creatorMemberId === group.me.memberId || group.me.role === "admin";
  const settlement = group.settlementCurrency;
  const foreign = expense.originalCurrency !== settlement;
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <ScreenHeader
        title={t("expense.detail")}
        back={`/groups/${group.id}`}
        action={
          canChange ? (
            <Link
              to={`/groups/${group.id}/expenses/${expense.id}/edit`}
              aria-label={t("expense.editAction")}
              className="rounded-full p-2 text-sprout-600"
            >
              <Pencil aria-hidden="true" className="size-6" />
            </Link>
          ) : undefined
        }
      />
      <section className="flex flex-col gap-3 rounded-3xl bg-sprout-150 p-6">
        <p className="text-ink-muted">
          {expense.category} · {expense.description}
        </p>
        <p className="text-4xl font-bold">
          {formatAmount(expense.originalAmount, expense.originalCurrency)}
        </p>
        {foreign && (
          <div className="flex flex-col gap-1 text-sm">
            <span>
              {t("expense.rateLine", {
                base: expense.originalCurrency,
                quote: settlement,
                rate: formatRate(expense.fxRateScaled),
                date: expense.fxDate,
              })}
              {expense.isCustomRate && (
                <span className="ml-2 rounded-full bg-peach px-2 py-0.5 text-xs font-bold">
                  {t("expense.rateEdited")}
                </span>
              )}
            </span>
            <span className="font-bold">
              {t("expense.convertedLine", {
                amount: formatAmount(expense.settlementAmount, settlement),
              })}
            </span>
          </div>
        )}
        <p className="text-sm text-ink-muted">
          {expense.expenseDate.replaceAll("-", " / ")}
          {expense.expenseTime === null ? "" : ` ${expense.expenseTime}`} · {group.name}
        </p>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">{t("expense.payers")}</h2>
        <ul className="flex flex-col gap-2">
          {expense.payers.map((p) => (
            <li key={p.memberId} className={`${card} flex items-center gap-3 px-4 py-3`}>
              <Avatar name={nameOf(p.memberId)} className="size-9" />
              <span className="flex-1 font-bold">{nameOf(p.memberId)}</span>
              <span className="text-sm text-ink-muted">
                {t("expense.paidFirst", {
                  amount: formatAmount(p.amountMinor, expense.originalCurrency),
                })}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">{t("expense.splitLines")}</h2>
        <ul
          aria-label={t("expense.splitLines")}
          className="flex flex-col divide-y divide-sprout-200"
        >
          {expense.splits.map((s) => (
            <li key={s.memberId} className="flex items-center justify-between px-2 py-3">
              <span>{nameOf(s.memberId)}</span>
              <span className="font-bold text-sprout-600">
                {formatAmount(s.settlementAmount, settlement)}
              </span>
            </li>
          ))}
        </ul>
      </section>
      {canChange && <DeleteExpense group={group} expense={expense} />}
    </div>
  );
}

function DeleteExpense({ group, expense }: { group: Group; expense: Expense }) {
  const remove = useDeleteExpense(group.id);
  const navigate = useNavigate();
  return (
    <Dialog.Root
      onOpenChange={() => {
        remove.reset();
      }}
    >
      <Dialog.Trigger className={`${secondaryButton} py-3 text-red-700`}>
        <Trash2 aria-hidden="true" className="size-5" />
        {t("expense.delete")}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-20 bg-black/40" />
        <Dialog.Content className="fixed inset-x-4 top-1/3 z-30 mx-auto flex max-w-md flex-col gap-4 rounded-3xl bg-white p-6">
          <Dialog.Title className="text-xl font-bold">
            {t("expense.deleteTitle", { name: expense.description })}
          </Dialog.Title>
          <Dialog.Description className="text-ink-muted">
            {t("expense.deleteBody")}
          </Dialog.Description>
          {remove.isError && (
            <p role="alert" className="rounded-2xl bg-peach p-3 font-bold">
              {failureMessage(remove.error)}
            </p>
          )}
          <div className="flex gap-3">
            <Dialog.Close className={`${secondaryButton} flex-1 py-3`}>
              {t("common.cancel")}
            </Dialog.Close>
            <button
              type="button"
              className={`${primaryButton} flex-1 bg-red-700 py-3 hover:bg-red-700/90`}
              disabled={remove.isPending}
              onClick={() => {
                remove.mutate(expense.id, {
                  onSuccess: () => void navigate(`/groups/${group.id}`),
                });
              }}
            >
              {t("expense.deleteConfirm")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
