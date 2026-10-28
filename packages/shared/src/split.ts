import { isValidExpenseAmount } from "./currency.js";
import { err, ok, type Result } from "./result.js";

/** One Member's portion of an Expense, in minor units. */
export interface SplitLine {
  memberId: string;
  amountMinor: number;
}

export interface SharesInput {
  memberId: string;
  shares: number;
}

export type SplitError =
  | "EXPENSE_AMOUNT_INVALID"
  | "SPLIT_NO_PARTICIPANTS"
  | "SPLIT_DUPLICATE_MEMBER"
  | "SPLIT_SHARES_INVALID"
  | "SPLIT_AMOUNT_INVALID"
  | "SPLIT_SUM_MISMATCH";

export const MIN_SHARES = 1;
export const MAX_SHARES = 99;

/**
 * Divides `total` in proportion to `weights` with the deterministic leftover rule:
 * every line gets floor(total * weight / sum), then leftover units go one each, first to
 * lines whose member is in `firstInLine` (payers), then to the rest, both in input order.
 * Weights must be non-negative integers with a positive sum. BigInt keeps the products exact.
 */
export function allocateWithLeftover(
  total: number,
  weighted: readonly { memberId: string; weight: number }[],
  firstInLine: readonly string[],
): SplitLine[] {
  const bigTotal = BigInt(total);
  const sum = weighted.reduce((s, w) => s + BigInt(w.weight), 0n);
  const lines = weighted.map((w) => ({
    memberId: w.memberId,
    amountMinor: Number((bigTotal * BigInt(w.weight)) / sum),
    hasRemainder: (bigTotal * BigInt(w.weight)) % sum !== 0n,
  }));
  let leftover = total - lines.reduce((s, l) => s + l.amountMinor, 0);
  const first = new Set(firstInLine);
  const order = [
    ...lines.filter((l) => first.has(l.memberId)),
    ...lines.filter((l) => !first.has(l.memberId)),
  ];
  for (const line of order) {
    if (leftover === 0) break;
    if (!line.hasRemainder) continue;
    line.amountMinor += 1;
    leftover -= 1;
  }
  return lines.map(({ memberId, amountMinor }) => ({ memberId, amountMinor }));
}

function checkParticipants(total: number, memberIds: readonly string[]): SplitError | undefined {
  if (!isValidExpenseAmount(total)) return "EXPENSE_AMOUNT_INVALID";
  if (memberIds.length === 0) return "SPLIT_NO_PARTICIPANTS";
  if (new Set(memberIds).size !== memberIds.length) return "SPLIT_DUPLICATE_MEMBER";
  return undefined;
}

/**
 * Equal split. `participants` is in the Group's fixed member order; `payerIds` are the
 * Expense's payers, who take leftover units first when they take part.
 */
export function splitEqual(
  total: number,
  participants: readonly string[],
  payerIds: readonly string[],
): Result<SplitLine[], SplitError> {
  const problem = checkParticipants(total, participants);
  if (problem) return err(problem);
  return ok(
    allocateWithLeftover(
      total,
      participants.map((memberId) => ({ memberId, weight: 1 })),
      payerIds,
    ),
  );
}

/** Shares split: whole-number weights 1 to 99, leftover by the same rule as an equal split. */
export function splitShares(
  total: number,
  lines: readonly SharesInput[],
  payerIds: readonly string[],
): Result<SplitLine[], SplitError> {
  const problem = checkParticipants(
    total,
    lines.map((l) => l.memberId),
  );
  if (problem) return err(problem);
  if (
    lines.some((l) => !Number.isInteger(l.shares) || l.shares < MIN_SHARES || l.shares > MAX_SHARES)
  ) {
    return err("SPLIT_SHARES_INVALID");
  }
  return ok(
    allocateWithLeftover(
      total,
      lines.map((l) => ({ memberId: l.memberId, weight: l.shares })),
      payerIds,
    ),
  );
}

/** Exact split: the typed amounts must add up to the total; there is no automatic balancing. */
export function splitExact(
  total: number,
  lines: readonly SplitLine[],
): Result<SplitLine[], SplitError> {
  const problem = checkParticipants(
    total,
    lines.map((l) => l.memberId),
  );
  if (problem) return err(problem);
  if (lines.some((l) => !Number.isInteger(l.amountMinor) || l.amountMinor < 0)) {
    return err("SPLIT_AMOUNT_INVALID");
  }
  if (lines.reduce((s, l) => s + l.amountMinor, 0) !== total) return err("SPLIT_SUM_MISMATCH");
  return ok(lines.map(({ memberId, amountMinor }) => ({ memberId, amountMinor })));
}
