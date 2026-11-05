import {
  type Balances,
  type Group,
  canConfirmSettlement,
  maxPayable as settlementLimit,
} from "@split/shared";

/** Adapts the shared Settlement rules to the web's Balance rows. */
export type BalanceRow = Balances["balances"][number];
type Me = Pick<Group["me"], "memberId" | "role">;

export { canUndoSettlement as canUndo } from "@split/shared";

export function canConfirm(me: Me, payer: BalanceRow, receiver: BalanceRow): boolean {
  return canConfirmSettlement(me, payer.memberId, receiver.memberId);
}

export function maxPayable(payer: BalanceRow, receiver: BalanceRow): number {
  return settlementLimit(payer.balance, receiver.balance);
}
