import { CURRENCY_CODES, type CurrencyCode, formatAmount, type Group } from "@split/shared";

export interface PendingTotals {
  /** One entry per currency that has a pending Balance, in CURRENCY_CODES order. */
  totals: { currency: CurrencyCode; amount: number }[];
  /** Groups where the person's Balance is not zero. */
  pendingGroups: number;
}

/**
 * The person's Balances summed per Settlement currency. Currencies are never converted
 * or added together (SPEC §6).
 */
export function pendingTotals(groups: readonly Group[]): PendingTotals {
  const pending = groups.filter((g) => g.me.balance !== 0);
  const totals = CURRENCY_CODES.flatMap((currency) => {
    const inCurrency = pending.filter((g) => g.settlementCurrency === currency);
    if (inCurrency.length === 0) return [];
    return [{ currency, amount: inCurrency.reduce((sum, g) => sum + g.me.balance, 0) }];
  });
  return { totals, pendingGroups: pending.length };
}

/** "NT$ 293 · US$ 12.50"; with nothing pending, a zero in the first currency. */
export function formatTotals({ totals }: PendingTotals): string {
  if (totals.length === 0) return formatAmount(0, CURRENCY_CODES[0]);
  return totals.map((x) => formatAmount(x.amount, x.currency)).join(" · ");
}
