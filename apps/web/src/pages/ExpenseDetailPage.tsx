import * as Dialog from "@radix-ui/react-dialog";
import { type Expense, formatAmount, formatRate, type Group } from "@split/shared";
import { Pencil, Share2, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { useDeleteExpense, useExpense } from "../expenses/api.js";
import { CategoryIcon, categoryTone } from "../expenses/CategoryIcon.js";
import type { ExpenseCard } from "../expenses/expense-card.js";
import { useExpenseSharing } from "../expenses/expense-sharing.js";
import { ExpenseShareDialog } from "../expenses/ExpenseShareDialog.js";
import { dateHeading, memberNames, memberPictures } from "../expenses/ExpenseList.js";
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
import { categoryLabel } from "../expenses/categories.js";
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
  const pictureOf = memberPictures(members.data);
  return <Detail group={group.data} expense={expense.data} nameOf={nameOf} pictureOf={pictureOf} />;
}

/** The Group a person has just joined by opening this Expense, carried in the router state. */
function joinedGroupName(state: unknown): string | undefined {
  if (typeof state !== "object" || state === null || !("joined" in state)) return undefined;
  return typeof state.joined === "string" ? state.joined : undefined;
}

function Detail({
  group,
  expense,
  nameOf,
  pictureOf,
}: {
  group: Group;
  expense: Expense;
  nameOf: (id: string) => string;
  pictureOf: (id: string) => string | null;
}) {
  const canChange = expense.creatorMemberId === group.me.memberId || group.me.role === "admin";
  const [sharing, setSharing] = useState(false);
  const [shareCard, setShareCard] = useState<ExpenseCard | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const joined = joinedGroupName(useLocation().state);
  const share = useExpenseSharing(group.id);
  const settlement = group.settlementCurrency;
  const foreign = expense.originalCurrency !== settlement;
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      {joined !== undefined && (
        <p role="status" className="rounded-2xl bg-sprout-150 px-4 py-2 text-sm font-bold">
          {t("join.joined", { name: joined })}
        </p>
      )}
      <ScreenHeader
        title={t("expense.detail")}
        back={`/groups/${group.id}`}
        action={
          <span className="flex items-center">
            <button
              type="button"
              aria-label={t("expenseShare.action")}
              onClick={() => {
                void share.prepare(expense, group, nameOf, false).then(({ card: prepared }) => {
                  setShareCard(prepared);
                  setSharing(true);
                });
              }}
              className="press-icon flex size-11 items-center justify-center rounded-full text-sprout-600 hover:bg-sprout-150"
            >
              <Share2 aria-hidden="true" className="size-6" />
            </button>
            {canChange && (
              <Link
                to={`/groups/${group.id}/expenses/${expense.id}/edit`}
                aria-label={t("expense.editAction")}
                className="press-icon rounded-full p-2 text-sprout-600 hover:bg-sprout-150"
              >
                <Pencil aria-hidden="true" className="size-6" />
              </Link>
            )}
          </span>
        }
      />
      <section
        className={`surface-card overflow-hidden rounded-3xl border border-sprout-200 bg-white ${
          isDeleting ? "expense-delete-slide" : ""
        }`}
      >
        <div className="flex items-center gap-3 bg-sprout-150 px-6 py-4">
          <span
            className={`flex size-12 shrink-0 items-center justify-center rounded-full shadow-xs ${categoryTone(expense.category).badge}`}
          >
            <CategoryIcon category={expense.category} className="size-6" />
          </span>
          <div className="flex min-w-0 flex-col items-start gap-1">
            <h2 className="break-words text-xl font-bold">{expense.description}</h2>
            <span
              className={`rounded-full px-3 py-0.5 text-xs font-bold ${categoryTone(expense.category).badge}`}
            >
              {categoryLabel(expense.category)}
            </span>
          </div>
        </div>
        <div className="receipt-divider flex flex-col items-center gap-2 px-6 py-6 text-center">
          <p className="text-sm text-ink-muted">{t("expense.total")}</p>
          <p className="text-4xl font-bold tabular-nums text-sprout-700">
            {formatAmount(expense.originalAmount, expense.originalCurrency)}
          </p>
          {foreign && (
            <div className="mt-1 flex flex-col gap-1 rounded-2xl bg-sprout-100 px-4 py-2 text-sm">
              <span className="text-ink-muted">
                {t("expense.rateLine", {
                  base: expense.originalCurrency,
                  quote: settlement,
                  rate: formatRate(expense.fxRateScaled),
                  date: expense.fxDate,
                })}
                {expense.isCustomRate && (
                  <span className="ml-2 rounded-full bg-peach px-2 py-0.5 text-xs font-bold text-ink">
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
          <p className="mt-1 text-sm text-ink-muted">
            {dateHeading(expense.expenseDate)}
            {expense.expenseTime === null ? "" : ` ${expense.expenseTime}`}
          </p>
        </div>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">{t("expense.payers")}</h2>
        <ul className="flex flex-col gap-2">
          {expense.payers.map((p) => (
            <li key={p.memberId} className={`${card} flex items-center gap-3 px-4 py-3`}>
              <Avatar
                name={nameOf(p.memberId)}
                pictureUrl={pictureOf(p.memberId)}
                className="size-9"
              />
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
            <li key={s.memberId} className="flex items-center gap-3 px-2 py-3">
              <Avatar
                name={nameOf(s.memberId)}
                pictureUrl={pictureOf(s.memberId)}
                className="size-9"
              />
              <span className="min-w-0 flex-1 break-words">
                {nameOf(s.memberId)}
                {s.memberId === group.me.memberId && t("settle.chartMe")}
              </span>
              <span className="font-bold text-sprout-600">
                {formatAmount(s.settlementAmount, settlement)}
              </span>
            </li>
          ))}
        </ul>
      </section>
      {canChange && (
        <DeleteExpense
          group={group}
          expense={expense}
          onDeleting={() => {
            setIsDeleting(true);
          }}
          onDeleteFailed={() => {
            setIsDeleting(false);
          }}
        />
      )}
      {shareCard !== null && (
        <ExpenseShareDialog card={shareCard} open={sharing} onOpenChange={setSharing} />
      )}
    </div>
  );
}

function DeleteExpense({
  group,
  expense,
  onDeleting,
  onDeleteFailed,
}: {
  group: Group;
  expense: Expense;
  onDeleting?: () => void;
  onDeleteFailed?: () => void;
}) {
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
        <Dialog.Overlay className="dialog-overlay glass-overlay fixed inset-0 z-20" />
        <Dialog.Content className="dialog-content glass-dialog fixed inset-x-4 top-1/3 z-30 mx-auto flex max-w-md flex-col gap-4 rounded-3xl border border-sprout-200/80 p-6">
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
                onDeleting?.();
                remove.mutate(expense.id, {
                  onSuccess: () => void navigate(`/groups/${group.id}`),
                  onError: () => {
                    onDeleteFailed?.();
                  },
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
