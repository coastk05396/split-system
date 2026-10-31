import type { Balances, Group, Settlement } from "@split/shared";

/** Who may do what to a Settlement; mirrors the Worker's rules (decisions 12, 23, 31). */

export type BalanceRow = Balances["balances"][number];
type Me = Pick<Group["me"], "memberId" | "role">;

/** The payer, the receiver, or an Admin confirms a Settlement. */
export function canConfirm(me: Me, payer: BalanceRow, receiver: BalanceRow): boolean {
  return me.memberId === payer.memberId || me.memberId === receiver.memberId || me.role === "admin";
}

/** The payer, the receiver, whoever confirmed it, or an Admin undoes a confirmed Settlement. */
export function canUndo(me: Me, s: Settlement): boolean {
  return (
    s.payerMemberId === me.memberId ||
    s.receiverMemberId === me.memberId ||
    s.confirmedByMemberId === me.memberId ||
    me.role === "admin"
  );
}

/** The most the payer can still pay this receiver: neither Balance may pass zero. */
export function maxPayable(payer: BalanceRow, receiver: BalanceRow): number {
  return Math.max(0, Math.min(-payer.balance, receiver.balance));
}
