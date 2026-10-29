import type { Balances, Group, Settlement } from "@split/shared";

/** Who may do what to a Settlement; mirrors the Worker's rules (decisions 12, 23, 31). */

export type BalanceRow = Balances["balances"][number];
type Me = Group["me"];

/** The receiver confirms; an Admin may for anyone except their own payment, unless the receiver is a Placeholder. */
export function canConfirm(me: Me, payer: BalanceRow, receiver: BalanceRow): boolean {
  if (me.memberId === receiver.memberId) return true;
  return me.role === "admin" && (me.memberId !== payer.memberId || receiver.status === "placeholder");
}

/** The payer, whoever recorded it, or an Admin withdraws a pending Settlement. */
export function canCancel(me: Me, s: Settlement): boolean {
  return me.memberId === s.payerMemberId || me.memberId === s.createdByMemberId || me.role === "admin";
}

/** Whoever confirmed it, or an Admin, undoes a confirmed Settlement. */
export function canUndo(me: Me, s: Settlement): boolean {
  return s.confirmedByMemberId === me.memberId || me.role === "admin";
}

/** The most the payer can still pay this receiver: neither Balance may pass zero. */
export function maxPayable(payer: BalanceRow, receiver: BalanceRow): number {
  return Math.max(0, Math.min(-payer.balance, receiver.balance));
}
