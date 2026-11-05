import { z } from "zod";

/** Settlements (SPEC §5; decisions 12, 15, 16, 23, 31). */

/** Rows per page of `GET /groups/:id/settlements` (decision 16). */
export const SETTLEMENT_PAGE_SIZE = 50;

/**
 * New Settlements are `confirmed` by the payer, receiver or an Admin; `undone` keeps their
 * reversal in history. `pending` and `cancelled` remain readable for legacy rows and clients.
 */
export const SETTLEMENT_STATUSES = ["pending", "confirmed", "cancelled", "undone"] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

const int = z.number().int();

/** A Settlement as the API returns it; `amount` is in the Group's Settlement currency. */
export const settlementSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  payerMemberId: z.string(),
  receiverMemberId: z.string(),
  amount: int,
  status: z.enum(SETTLEMENT_STATUSES),
  createdByMemberId: z.string().nullable(),
  confirmedByMemberId: z.string().nullable(),
  confirmedAt: int.nullable(),
  undoneByMemberId: z.string().nullable(),
  undoneAt: int.nullable(),
  createdAt: int,
  updatedAt: int,
});
export type Settlement = z.infer<typeof settlementSchema>;

/** One page of a Group's Settlements, newest first; `nextCursor` is null on the last page. */
export const settlementPageSchema = z.object({
  settlements: z.array(settlementSchema),
  nextCursor: z.string().nullable(),
});
export type SettlementPage = z.infer<typeof settlementPageSchema>;

type SettlementActor = { memberId: string; role: string };

/** The payer, receiver, or an Admin may confirm a Settlement. */
export function canConfirmSettlement(
  actor: SettlementActor,
  payerMemberId: string,
  receiverMemberId: string,
): boolean {
  return (
    actor.memberId === payerMemberId ||
    actor.memberId === receiverMemberId ||
    actor.role === "admin"
  );
}

/** Status and active-Member validation stay at the operation boundary. */
export function canUndoSettlement(
  actor: SettlementActor,
  settlement: Pick<Settlement, "payerMemberId" | "receiverMemberId" | "confirmedByMemberId">,
): boolean {
  return (
    actor.memberId === settlement.payerMemberId ||
    actor.memberId === settlement.receiverMemberId ||
    actor.memberId === settlement.confirmedByMemberId ||
    actor.role === "admin"
  );
}

/** Integer minor units: neither the payer nor receiver may cross a zero Balance. */
export function maxPayable(payerBalance: number, receiverBalance: number): number {
  return Math.max(0, Math.min(-payerBalance, receiverBalance));
}
