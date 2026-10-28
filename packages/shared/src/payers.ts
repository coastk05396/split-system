import { err, ok, type Result } from "./result.js";
import { allocateWithLeftover, type SplitLine } from "./split.js";

export type PayerError =
  "PAYERS_EMPTY" | "PAYER_DUPLICATE_MEMBER" | "PAYER_AMOUNT_INVALID" | "PAYERS_SUM_MISMATCH";

/** Several payers (誰先付錢): each pays a positive amount and together they pay the whole Expense. */
export function validatePayers(
  total: number,
  payers: readonly SplitLine[],
): Result<SplitLine[], PayerError> {
  if (payers.length === 0) return err("PAYERS_EMPTY");
  if (new Set(payers.map((p) => p.memberId)).size !== payers.length) {
    return err("PAYER_DUPLICATE_MEMBER");
  }
  if (payers.some((p) => !Number.isInteger(p.amountMinor) || p.amountMinor < 1)) {
    return err("PAYER_AMOUNT_INVALID");
  }
  if (payers.reduce((s, p) => s + p.amountMinor, 0) !== total) return err("PAYERS_SUM_MISMATCH");
  return ok(payers.map(({ memberId, amountMinor }) => ({ memberId, amountMinor })));
}

/**
 * Converts payer or split lines (Expense currency) into the Settlement currency so they add up
 * to `convertedTotal` exactly: proportional to the original amounts, leftover units by the
 * same rule as the splits (payers first, then input order). Original lines must sum above zero.
 */
export function convertLines(
  lines: readonly SplitLine[],
  convertedTotal: number,
  payerIds: readonly string[],
): SplitLine[] {
  return allocateWithLeftover(
    convertedTotal,
    lines.map((l) => ({ memberId: l.memberId, weight: l.amountMinor })),
    payerIds,
  );
}
