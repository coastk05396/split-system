import type { Expense, ExpenseInput } from "@split/shared";

const byMember = <T extends { memberId: string }>(lines: T[]) =>
  [...lines].sort((a, b) => (a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0));

const key = (lines: [string, number][]) => JSON.stringify(lines);

/**
 * Whether the server already holds exactly this edit. A retry whose answer was lost meets
 * EDIT_CONFLICT (its If-Match is stale), and this tells that apart from someone else's edit.
 * Any doubt answers false: the User is then shown the conflict rather than losing a change.
 */
export function sameEdit(input: ExpenseInput, held: Expense): boolean {
  if (
    input.description !== held.description ||
    input.category !== held.category ||
    input.originalAmount !== held.originalAmount ||
    input.originalCurrency !== held.originalCurrency ||
    input.fxRateScaled !== held.fxRateScaled ||
    input.fxDate !== held.fxDate ||
    input.isCustomRate !== held.isCustomRate ||
    input.settlementAmount !== held.settlementAmount ||
    input.expenseDate !== held.expenseDate ||
    (input.expenseTime ?? null) !== held.expenseTime ||
    (input.stopId ?? null) !== held.stopId ||
    input.split.method !== held.splitMethod
  )
    return false;
  const payers = (xs: { memberId: string; amountMinor: number }[]) =>
    key(byMember(xs).map((p) => [p.memberId, p.amountMinor]));
  if (payers(input.payers) !== payers(held.payers)) return false;
  const split = input.split;
  const splits = byMember(held.splits);
  switch (split.method) {
    case "equal":
      return (
        key([...split.participants].sort().map((id) => [id, 0])) ===
        key(splits.map((s) => [s.memberId, 0]))
      );
    case "exact":
      return (
        key(byMember(split.lines).map((l) => [l.memberId, l.amountMinor])) ===
        key(splits.map((s) => [s.memberId, s.amountMinor]))
      );
    case "shares":
      return (
        key(byMember(split.lines).map((l) => [l.memberId, l.shares])) ===
        key(splits.map((s) => [s.memberId, s.shares ?? 0]))
      );
  }
}
