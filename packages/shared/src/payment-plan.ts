import { err, ok, type Result } from "./result.js";

/** A Member's Balance in the Settlement currency: positive is owed, negative owes. */
export interface Balance {
  memberId: string;
  amountMinor: number;
}

/** One suggested Settlement in a Payment plan. */
export interface PlannedPayment {
  fromMemberId: string;
  toMemberId: string;
  amountMinor: number;
}

/**
 * `exact`: fewest payments (label 最少筆數). `greedy`: at most `maxPayments` (label 至多 N−1 筆).
 * `maxPayments` is N−1 for N non-zero Balances.
 */
export interface PaymentPlan {
  method: "exact" | "greedy";
  payments: PlannedPayment[];
  maxPayments: number;
}

export type PaymentPlanError =
  "BALANCE_AMOUNT_INVALID" | "BALANCE_DUPLICATE_MEMBER" | "BALANCES_SUM_NOT_ZERO";

/** Above this many non-zero Balances the exact search is skipped for greedy (SPEC §3.4). */
export const EXACT_PLAN_LIMIT = 20;

/** The Payment plan for a Group's Balances: exact for up to 20 non-zero Balances, else greedy. */
export function planPayments(balances: readonly Balance[]): Result<PaymentPlan, PaymentPlanError> {
  if (balances.some((b) => !Number.isSafeInteger(b.amountMinor))) {
    return err("BALANCE_AMOUNT_INVALID");
  }
  if (new Set(balances.map((b) => b.memberId)).size !== balances.length) {
    return err("BALANCE_DUPLICATE_MEMBER");
  }
  if (balances.reduce((s, b) => s + b.amountMinor, 0) !== 0) return err("BALANCES_SUM_NOT_ZERO");
  const ordered = orderBalances(balances);
  const maxPayments = Math.max(ordered.length - 1, 0);
  if (ordered.length > EXACT_PLAN_LIMIT) {
    return ok({ method: "greedy", payments: settleGreedy(ordered), maxPayments });
  }
  return ok({ method: "exact", payments: settleExact(ordered), maxPayments });
}

/** Greedy plan for any number of Balances: at most N−1 payments, not always the fewest. */
export function greedyPayments(balances: readonly Balance[]): PlannedPayment[] {
  return settleGreedy(orderBalances(balances));
}

/** Exact fewest-payments plan. Cost is O(2^N · N); keep N at or below `EXACT_PLAN_LIMIT`. */
export function exactPayments(balances: readonly Balance[]): PlannedPayment[] {
  return settleExact(orderBalances(balances));
}

/** Drops zero Balances; fixed tie-break: larger amount first, then input (member) order. */
function orderBalances(balances: readonly Balance[]): Balance[] {
  return balances
    .map((b, index) => ({ b, index }))
    .filter(({ b }) => b.amountMinor !== 0)
    .sort((x, y) => Math.abs(y.b.amountMinor) - Math.abs(x.b.amountMinor) || x.index - y.index)
    .map(({ b }) => ({ memberId: b.memberId, amountMinor: b.amountMinor }));
}

/**
 * Greedy: the largest debtor pays the largest creditor until one of them is at zero.
 * Each payment zeroes at least one Balance, so N Balances take at most N−1 payments.
 */
function settleGreedy(ordered: readonly Balance[]): PlannedPayment[] {
  const debtors = ordered
    .filter((b) => b.amountMinor < 0)
    .map((b) => ({ memberId: b.memberId, left: -b.amountMinor }));
  const creditors = ordered
    .filter((b) => b.amountMinor > 0)
    .map((b) => ({ memberId: b.memberId, left: b.amountMinor }));
  const payments: PlannedPayment[] = [];
  for (;;) {
    const debtor = largest(debtors);
    const creditor = largest(creditors);
    if (!debtor || !creditor) return payments;
    const amountMinor = Math.min(debtor.left, creditor.left);
    payments.push({ fromMemberId: debtor.memberId, toMemberId: creditor.memberId, amountMinor });
    debtor.left -= amountMinor;
    creditor.left -= amountMinor;
  }
}

/** First entry with the largest positive `left` (ties keep the fixed order). */
function largest<T extends { left: number }>(items: readonly T[]): T | undefined {
  let best: T | undefined;
  for (const item of items) {
    if (item.left > 0 && (!best || item.left > best.left)) best = item;
  }
  return best;
}

/**
 * Exact: the fewest payments is N − k, where k is the most zero-sum groups the Balances split
 * into. `groups[mask]` is the most zero-sum groups in an ordering of the subset `mask`, built by
 * adding one Balance at a time (O(2^N · N)). Each group is then settled with greedy (size − 1).
 */
function settleExact(ordered: readonly Balance[]): PlannedPayment[] {
  const n = ordered.length;
  const size = 1 << n;
  const sums = new Float64Array(size);
  const groups = new Int8Array(size);
  for (let mask = 1; mask < size; mask++) {
    const low = 31 - Math.clz32(mask & -mask);
    sums[mask] = (sums[mask & (mask - 1)] ?? 0) + (ordered[low]?.amountMinor ?? 0);
    let best = 0;
    for (let rest = mask; rest !== 0; rest &= rest - 1) {
      const g = groups[mask ^ (rest & -rest)] ?? 0;
      if (g > best) best = g;
    }
    groups[mask] = best + (sums[mask] === 0 ? 1 : 0);
  }

  // Walk back from the full set; every zero-sum prefix closes a group.
  const groupMasks: number[] = [];
  let mask = size - 1;
  let groupEnd = mask;
  while (mask !== 0) {
    const zero = sums[mask] === 0 ? 1 : 0;
    let next = mask;
    for (let i = 0; i < n; i++) {
      const bit = 1 << i;
      if ((mask & bit) !== 0 && (groups[mask ^ bit] ?? 0) + zero === groups[mask]) {
        next = mask ^ bit;
        break;
      }
    }
    if (sums[next] === 0) {
      groupMasks.push(groupEnd ^ next);
      groupEnd = next;
    }
    mask = next;
  }

  return groupMasks
    .sort((a, b) => (a & -a) - (b & -b))
    .flatMap((g) => settleGreedy(ordered.filter((_, i) => (g & (1 << i)) !== 0)));
}
