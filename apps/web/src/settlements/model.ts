import type { Balance, Balances, Group, Settlement } from "@split/shared";

/** Who may do what to a Settlement; mirrors the Worker's rules (decisions 12, 23, 31). */

export type BalanceRow = Balances["balances"][number];
type Me = Group["me"];

/** The receiver confirms; an Admin may for anyone except their own payment, unless the receiver is a Placeholder. */
export function canConfirm(me: Me, payer: BalanceRow, receiver: BalanceRow): boolean {
  if (me.memberId === receiver.memberId) return true;
  return (
    me.role === "admin" && (me.memberId !== payer.memberId || receiver.status === "placeholder")
  );
}

/** The payer, whoever recorded it, or an Admin withdraws a pending Settlement. */
export function canCancel(me: Me, s: Settlement): boolean {
  return (
    me.memberId === s.payerMemberId || me.memberId === s.createdByMemberId || me.role === "admin"
  );
}

/** Whoever confirmed it, or an Admin, undoes a confirmed Settlement. */
export function canUndo(me: Me, s: Settlement): boolean {
  return s.confirmedByMemberId === me.memberId || me.role === "admin";
}

/**
 * The Balances as they will stand once every pending Settlement is confirmed, for planning
 * what is still owed. A pending Settlement moves no Balance until it is confirmed, so the
 * plan must not be drawn from the raw Balances while one waits: it would suggest the same
 * money again, or hide the rest of a pair. Like a confirmation, each one is capped so neither
 * Balance passes zero (a stale amount counts for what can still be paid), and they apply
 * oldest first so every device gets the same plan.
 */
export function balancesAfterPending(
  balances: readonly Pick<BalanceRow, "memberId" | "balance">[],
  pending: readonly Pick<
    Settlement,
    "payerMemberId" | "receiverMemberId" | "amount" | "createdAt"
  >[],
): Balance[] {
  const left = new Map(balances.map((b) => [b.memberId, b.balance]));
  for (const s of [...pending].sort((a, b) => a.createdAt - b.createdAt)) {
    const payer = left.get(s.payerMemberId);
    const receiver = left.get(s.receiverMemberId);
    if (payer === undefined || receiver === undefined) continue;
    const covered = Math.max(0, Math.min(s.amount, -payer, receiver));
    left.set(s.payerMemberId, payer + covered);
    left.set(s.receiverMemberId, receiver - covered);
  }
  return balances.map((b) => ({ memberId: b.memberId, amountMinor: left.get(b.memberId) ?? 0 }));
}

/** The most the payer can still pay this receiver: neither Balance may pass zero. */
export function maxPayable(payer: BalanceRow, receiver: BalanceRow): number {
  return Math.max(0, Math.min(-payer.balance, receiver.balance));
}
