import {
  CURRENCY_CODES,
  type CurrencyCode,
  convertBalance,
  formatAmount,
  type Group,
  RATE_SCALE,
} from "@split/shared";
import { t } from "../i18n/messages.js";

export interface CurrencyTotal {
  currency: CurrencyCode;
  amount: number;
}

export interface PendingTotals {
  /** Every shipped currency, the Preferred currency first; a currency with nothing pending is 0. */
  totals: CurrencyTotal[];
  /** Groups where the person's Balance is not zero. */
  pendingGroups: number;
}

/**
 * The person's Balances summed per Settlement currency, the Preferred currency first. This
 * step never converts; `convertedTotal` does that for the Home total (ADR 0002).
 */
export function pendingTotals(groups: readonly Group[], preferred: CurrencyCode): PendingTotals {
  const pending = groups.filter((g) => g.me.balance !== 0);
  const ordered = [preferred, ...CURRENCY_CODES.filter((c) => c !== preferred)];
  const totals = ordered.map((currency) => ({
    currency,
    amount: pending
      .filter((g) => g.settlementCurrency === currency)
      .reduce((sum, g) => sum + g.me.balance, 0),
  }));
  return { totals, pendingGroups: pending.length };
}

/** "你要付 NT$ 50" for a negative Balance, "你可收 NT$ 50" for a positive one. */
export function balanceLine(balance: number, currency: CurrencyCode): string {
  return t(balance < 0 ? "groups.owe" : "groups.owed", {
    amount: formatAmount(Math.abs(balance), currency),
  });
}

/**
 * The pending Balances as one amount in the Preferred currency: the other currencies are
 * converted at the reference rate given for each (`rates`, scaled by 1,000,000). An approximate
 * figure for the Home screen, never an amount anyone settles. It is null when a currency with
 * something pending has no rate or cannot be converted, so the caller shows them side by side
 * instead of dropping any of them.
 */
export function convertedTotal(
  totals: readonly CurrencyTotal[],
  preferred: CurrencyCode,
  rates: ReadonlyMap<CurrencyCode, number>,
): number | null {
  let sum = 0;
  for (const { currency, amount } of totals) {
    if (amount === 0) continue;
    const rate = rates.get(currency);
    if (currency !== preferred && rate === undefined) return null;
    const converted = convertBalance(amount, currency, preferred, rate ?? RATE_SCALE);
    if (!converted.ok) return null;
    sum += converted.value;
  }
  return sum;
}
