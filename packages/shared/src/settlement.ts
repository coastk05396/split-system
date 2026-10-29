import { z } from "zod";
import { amountMinorSchema } from "./schemas.js";

/** Settlements (SPEC §5; decisions 12, 15, 16, 23, 31). */

/** Rows per page of `GET /groups/:id/settlements` (decision 16). */
export const SETTLEMENT_PAGE_SIZE = 50;

/**
 * `pending`: the payer said 我已付款, no Balance moved. `confirmed`: the receiver or an Admin
 * confirmed it and Balances moved. `cancelled`: withdrawn while pending. `undone`: a confirmed
 * Settlement reversed, kept in the history as 已撤銷.
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

/**
 * `POST /settlements/:sid/confirm` body, optional: the confirmer may lower a pending amount
 * to what was actually received (decision 12's partial payment); the rest stays a debt.
 */
export const settlementConfirmSchema = z.object({ amount: amountMinorSchema.optional() });
export type SettlementConfirm = z.infer<typeof settlementConfirmSchema>;
