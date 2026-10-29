import {
  type CurrencyCode,
  formatAmount,
  type Group,
  type PlannedPayment,
  type Settlement,
} from "@split/shared";
import { useRef, useState } from "react";
import { card, failureMessage, LoadError, Loading, secondaryButton } from "../groups/ui.js";
import { type MessageId, t } from "../i18n/messages.js";
import { useBalances, useRecordSettlement, useSettlementAction, useSettlements } from "./api.js";
import { ConfirmSettlementDialog } from "./ConfirmSettlementDialog.js";
import { type BalanceRow, canCancel, canConfirm, canUndo, maxPayable } from "./model.js";
import { usePaymentPlan } from "./use-payment-plan.js";

const smallButton = "rounded-full border border-sprout-200 px-4 py-2 text-sm font-bold";

/**
 * Screen 5 as amended (decisions 12, 17, 23): my Balance, the Payment plan with its honest
 * label, per-payment actions (我已付款, confirm, 待確認 and cancel) and the Settlement history
 * with undo and the 已撤銷 line. Everything is in the Group's Settlement currency.
 */
export function SettlePanel({ group }: { group: Group }) {
  const balances = useBalances(group.id);
  const settlements = useSettlements(group.id);
  const plan = usePaymentPlan(
    balances.data?.balances.map((b) => ({ memberId: b.memberId, amountMinor: b.balance })),
  );
  const action = useSettlementAction(group.id);

  if (balances.isError) {
    return <LoadError error={balances.error} onRetry={() => void balances.refetch()} />;
  }
  if (settlements.isError) {
    return <LoadError error={settlements.error} onRetry={() => void settlements.refetch()} />;
  }
  if (balances.isPending || settlements.isPending) return <Loading />;

  const currency = balances.data.settlementCurrency;
  const rows = new Map(balances.data.balances.map((b) => [b.memberId, b]));
  const nameOf = (id: string) => rows.get(id)?.displayName ?? "?";
  const mine = rows.get(group.me.memberId)?.balance ?? 0;
  const all = settlements.data.pages.flatMap((p) => p.settlements);
  const pending = all.filter((s) => s.status === "pending");
  const history = all.filter((s) => s.status !== "pending");

  return (
    <div className="flex flex-col gap-6 text-ink">
      <section className="flex flex-col gap-1 rounded-3xl bg-sprout-150 p-6">
        <h2 className="text-sm text-ink-muted">
          {t(mine > 0 ? "settle.owedToMe" : mine < 0 ? "settle.iOwe" : "settle.mineSettled")}
        </h2>
        <p className="text-4xl font-bold">{formatAmount(Math.abs(mine), currency)}</p>
      </section>

      {action.isError && (
        <p role="alert" className="text-red-700">
          {failureMessage(action.error)}
        </p>
      )}

      {pending.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-bold">{t("settle.pendingTitle")}</h2>
          <ul aria-label={t("settle.pendingTitle")} className="flex flex-col gap-2">
            {pending.map((s) => {
              const payer = rows.get(s.payerMemberId);
              const receiver = rows.get(s.receiverMemberId);
              return (
                <li key={s.id} className={`${card} flex flex-wrap items-center gap-3 px-4 py-3`}>
                  <PaymentLine
                    payer={nameOf(s.payerMemberId)}
                    receiver={nameOf(s.receiverMemberId)}
                    amount={s.amount}
                    currency={currency}
                    badge="settle.status.pending"
                  />
                  {payer !== undefined &&
                    receiver !== undefined &&
                    canConfirm(group.me, payer, receiver) && (
                      <ConfirmSettlementDialog
                        trigger={t("settle.confirmAction")}
                        currency={currency}
                        target={{
                          payerName: payer.displayName,
                          receiverName: receiver.displayName,
                          suggested: Math.min(s.amount, maxPayable(payer, receiver)),
                          max: maxPayable(payer, receiver),
                        }}
                        submit={(amount) =>
                          action.mutateAsync({
                            kind: "confirm",
                            settlementId: s.id,
                            ...(amount === s.amount ? {} : { amount }),
                          })
                        }
                      />
                    )}
                  {canCancel(group.me, s) && (
                    <button
                      type="button"
                      className={smallButton}
                      disabled={action.isPending}
                      onClick={() => {
                        action.mutate({ kind: "cancel", settlementId: s.id });
                      }}
                    >
                      {t("settle.cancel")}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h2 className="flex-1 text-lg font-bold">{t("settle.planTitle")}</h2>
          {plan.status === "ready" && plan.plan.payments.length > 0 && (
            <span className="rounded-full bg-peach px-3 py-1 text-xs font-bold text-sprout-700">
              {plan.plan.method === "exact"
                ? t("settle.label.exact")
                : t("settle.label.greedy", { count: plan.plan.maxPayments })}
            </span>
          )}
        </div>
        {plan.status === "computing" && <Loading />}
        {plan.status === "failed" && (
          <p role="alert" className="text-red-700">
            {t("settle.planFailed")}
          </p>
        )}
        {plan.status === "ready" &&
          (plan.plan.payments.length === 0 ? (
            <p className="py-4 text-center text-ink-muted">{t("settle.allSettled")}</p>
          ) : (
            <ul aria-label={t("settle.planTitle")} className="flex flex-col gap-2">
              {plan.plan.payments.map((p) => (
                <li
                  key={`${p.fromMemberId}-${p.toMemberId}`}
                  className={`${card} flex flex-wrap items-center gap-3 px-4 py-3`}
                >
                  <PlannedRow
                    group={group}
                    payment={p}
                    rows={rows}
                    currency={currency}
                    waiting={pending.some(
                      (s) =>
                        s.payerMemberId === p.fromMemberId && s.receiverMemberId === p.toMemberId,
                    )}
                  />
                </li>
              ))}
            </ul>
          ))}
      </section>

      {history.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-bold">{t("settle.historyTitle")}</h2>
          <ul aria-label={t("settle.historyTitle")} className="flex flex-col gap-2">
            {history.map((s) => (
              <li key={s.id} className={`${card} flex flex-wrap items-center gap-3 px-4 py-3`}>
                <PaymentLine
                  payer={nameOf(s.payerMemberId)}
                  receiver={nameOf(s.receiverMemberId)}
                  amount={s.amount}
                  currency={currency}
                  badge={statusLabel(s)}
                  struck={s.status !== "confirmed"}
                />
                {s.status === "confirmed" && canUndo(group.me, s) && (
                  <button
                    type="button"
                    className={smallButton}
                    disabled={action.isPending}
                    onClick={() => {
                      action.mutate({ kind: "undo", settlementId: s.id });
                    }}
                  >
                    {t("settle.undo")}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {settlements.hasNextPage && (
            <button
              type="button"
              className={`${secondaryButton} py-3`}
              disabled={settlements.isFetchingNextPage}
              onClick={() => void settlements.fetchNextPage()}
            >
              {t("expense.more")}
            </button>
          )}
        </section>
      )}
    </div>
  );
}

function statusLabel(s: Settlement): MessageId {
  if (s.status === "undone") return "settle.status.undone";
  if (s.status === "cancelled") return "settle.status.cancelled";
  return "settle.status.confirmed";
}

function PaymentLine({
  payer,
  receiver,
  amount,
  currency,
  badge,
  struck = false,
}: {
  payer: string;
  receiver: string;
  amount: number;
  currency: CurrencyCode;
  badge?: MessageId;
  struck?: boolean;
}) {
  return (
    <>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-bold">{t("settle.pays", { payer, receiver })}</span>
        {badge !== undefined && (
          <span className="text-xs font-bold text-sprout-700">{t(badge)}</span>
        )}
      </span>
      <span className={`font-bold ${struck ? "text-ink-muted line-through" : "text-sprout-600"}`}>
        {formatAmount(amount, currency)}
      </span>
    </>
  );
}

/** One suggested payment with what I may do about it. */
function PlannedRow({
  group,
  payment,
  rows,
  currency,
  waiting,
}: {
  group: Group;
  payment: PlannedPayment;
  rows: ReadonlyMap<string, BalanceRow>;
  currency: CurrencyCode;
  /** A 我已付款 for this pair waits for the receiver. */
  waiting: boolean;
}) {
  const record = useRecordSettlement(group.id);
  // One key per suggested payment, reused if a lost answer makes the person tap again.
  const key = useRef(crypto.randomUUID());
  const [failure, setFailure] = useState<unknown>(null);
  const payer = rows.get(payment.fromMemberId);
  const receiver = rows.get(payment.toMemberId);
  if (payer === undefined || receiver === undefined) return null;
  const input = (amount: number) => ({
    payerMemberId: payer.memberId,
    receiverMemberId: receiver.memberId,
    amount,
  });
  const saved = () => {
    key.current = crypto.randomUUID();
  };
  const iPay = group.me.memberId === payer.memberId;

  return (
    <>
      <PaymentLine
        payer={payer.displayName}
        receiver={receiver.displayName}
        amount={payment.amountMinor}
        currency={currency}
        {...(waiting ? { badge: "settle.status.pending" as const } : {})}
      />
      {iPay && !waiting && !canConfirm(group.me, payer, receiver) && (
        <button
          type="button"
          className={smallButton}
          disabled={record.isPending}
          onClick={() => {
            setFailure(null);
            record.mutate(
              { input: input(payment.amountMinor), idempotencyKey: key.current },
              { onSuccess: saved, onError: setFailure },
            );
          }}
        >
          {t("settle.iPaid")}
        </button>
      )}
      {!waiting && canConfirm(group.me, payer, receiver) && (
        <ConfirmSettlementDialog
          trigger={t("settle.markReceived")}
          currency={currency}
          target={{
            payerName: payer.displayName,
            receiverName: receiver.displayName,
            suggested: payment.amountMinor,
            max: maxPayable(payer, receiver),
          }}
          submit={(amount) =>
            record.mutateAsync({ input: input(amount), idempotencyKey: key.current }).then(saved)
          }
        />
      )}
      {failure !== null && (
        <p role="alert" className="w-full text-sm text-red-700">
          {failureMessage(failure)}
        </p>
      )}
    </>
  );
}
