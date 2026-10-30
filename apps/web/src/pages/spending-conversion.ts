import { CURRENCIES, type CurrencyCode, convertBalance, RATE_SCALE } from "@split/shared";

export type SpendingRow = {
  month: string;
  category: string;
  currency: CurrencyCode;
  amount: number;
};

/** Convert each month's currency total once, distributing rounded units across its categories. */
export function convertSpending(
  rows: readonly SpendingRow[],
  preferred: CurrencyCode,
  rates: ReadonlyMap<CurrencyCode, number>,
): SpendingRow[] | null {
  const groups = new Map<string, SpendingRow[]>();
  for (const row of rows) {
    const key = `${row.month}:${row.currency}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const converted: SpendingRow[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    if (first === undefined) continue;
    const rate = first.currency === preferred ? RATE_SCALE : rates.get(first.currency);
    if (rate === undefined) return null;
    const total = group.reduce((sum, row) => sum + row.amount, 0);
    const target = convertBalance(total, first.currency, preferred, rate);
    if (!target.ok) return null;
    const denominator = BigInt(RATE_SCALE) * 10n ** BigInt(CURRENCIES[first.currency].decimals);
    const factor = BigInt(rate) * 10n ** BigInt(CURRENCIES[preferred].decimals);
    const parts = group.map((row) => {
      const numerator = BigInt(row.amount) * factor;
      return { row, amount: Number(numerator / denominator), remainder: numerator % denominator };
    });
    let remaining = target.value - parts.reduce((sum, part) => sum + part.amount, 0);
    // Category name makes tied remainders deterministic even if the database changes row order.
    parts.sort((a, b) => {
      if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
      if (a.row.category < b.row.category) return -1;
      if (a.row.category > b.row.category) return 1;
      return 0;
    });
    for (const part of parts) {
      if (remaining > 0) {
        part.amount += 1;
        remaining -= 1;
      }
      converted.push({ ...part.row, currency: preferred, amount: part.amount });
    }
  }
  return converted;
}
