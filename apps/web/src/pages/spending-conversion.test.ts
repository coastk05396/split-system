import { describe, expect, it } from "vitest";
import { convertSpending, type SpendingRow } from "./spending-conversion.js";

describe("personal spending currency conversion", () => {
  it("keeps monthly totals unchanged when tiny shares are reclassified", () => {
    const separate: SpendingRow[] = [
      { month: "2026-10", currency: "USD", category: "餐飲", amount: 1 },
      { month: "2026-10", currency: "USD", category: "交通", amount: 1 },
    ];
    const combined: SpendingRow[] = [
      { month: "2026-10", currency: "USD", category: "餐飲", amount: 2 },
    ];
    const rates = new Map([["USD" as const, 31_523_400]]);
    const sum = (rows: SpendingRow[]) =>
      convertSpending(rows, "TWD", rates)?.reduce((n, row) => n + row.amount, 0);
    expect(sum(separate)).toBe(1);
    expect(sum(combined)).toBe(1);
    expect(
      convertSpending(separate, "TWD", rates)
        ?.map((r) => r.amount)
        .sort(),
    ).toEqual([0, 1]);
    expect(convertSpending(separate, "TWD", rates)?.every((r) => r.currency === "TWD")).toBe(true);
    expect(convertSpending([...separate].reverse(), "TWD", rates)).toEqual(
      convertSpending(separate, "TWD", rates),
    );
  });
  it("refuses to calculate an incomplete total when a rate is missing", () => {
    expect(
      convertSpending(
        [{ month: "2026-10", category: "餐飲", currency: "JPY", amount: 100 }],
        "TWD",
        new Map(),
      ),
    ).toBeNull();
  });
});
