import { describe, expect, it } from "vitest";
import { allocateExpense, type ExpenseAllocationInput } from "./expense.js";

const base: ExpenseAllocationInput = {
  originalAmount: 100,
  originalCurrency: "TWD",
  fxRateScaled: 1_000_000,
  isCustomRate: false,
  settlementAmount: 100,
  payers: [{ memberId: "b", amountMinor: 100 }],
  split: { method: "equal", participants: ["c", "b", "a"] },
};
const order = ["a", "b", "c"];

describe("allocateExpense", () => {
  it("splits NT$100 three ways as 34/33/33 with the payer taking the leftover", () => {
    const result = allocateExpense(base, "TWD", order);
    expect(result).toEqual({
      ok: true,
      value: {
        payers: [{ memberId: "b", amountMinor: 100, settlementAmount: 100 }],
        splits: [
          { memberId: "a", shares: null, amountMinor: 33, settlementAmount: 33 },
          { memberId: "b", shares: null, amountMinor: 34, settlementAmount: 34 },
          { memberId: "c", shares: null, amountMinor: 33, settlementAmount: 33 },
        ],
      },
    });
  });

  it("converts a US$ 10.00 Expense with two payers into whole New Taiwan dollars", () => {
    // 1000 cents at 31.5234 is NT$ 315.234, confirmed as NT$ 315.
    const usd: ExpenseAllocationInput = {
      originalAmount: 1000,
      originalCurrency: "USD",
      fxRateScaled: 31_523_400,
      isCustomRate: false,
      settlementAmount: 315,
      payers: [
        { memberId: "a", amountMinor: 500 },
        { memberId: "c", amountMinor: 500 },
      ],
      split: {
        method: "shares",
        lines: [
          { memberId: "a", shares: 1 },
          { memberId: "b", shares: 2 },
        ],
      },
    };
    const result = allocateExpense(usd, "TWD", order);
    expect(result).toEqual({
      ok: true,
      value: {
        payers: [
          { memberId: "a", amountMinor: 500, settlementAmount: 158 },
          { memberId: "c", amountMinor: 500, settlementAmount: 157 },
        ],
        splits: [
          { memberId: "a", shares: 1, amountMinor: 334, settlementAmount: 106 },
          { memberId: "b", shares: 2, amountMinor: 666, settlementAmount: 209 },
        ],
      },
    });
  });

  it("rejects a converted amount the reference rate does not give, unless the rate is custom", () => {
    const usd: ExpenseAllocationInput = {
      ...base,
      originalAmount: 1000,
      originalCurrency: "USD",
      fxRateScaled: 31_523_400,
      settlementAmount: 300,
      payers: [{ memberId: "a", amountMinor: 1000 }],
    };
    expect(allocateExpense(usd, "TWD", order)).toEqual({
      ok: false,
      error: "SETTLEMENT_AMOUNT_MISMATCH",
    });
    expect(allocateExpense({ ...usd, isCustomRate: true }, "TWD", order).ok).toBe(true);
  });

  it("rejects a same-currency Expense whose rate is not 1", () => {
    expect(allocateExpense({ ...base, fxRateScaled: 2_000_000 }, "TWD", order)).toEqual({
      ok: false,
      error: "RATE_INVALID",
    });
  });
});
