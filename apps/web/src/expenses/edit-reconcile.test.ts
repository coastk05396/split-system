import type { Expense, ExpenseInput } from "@split/shared";
import { describe, expect, it } from "vitest";
import { sameEdit } from "./edit-reconcile.js";

const input: ExpenseInput = {
  description: "晚餐",
  category: "餐飲",
  originalAmount: 300,
  originalCurrency: "TWD",
  fxRateScaled: 1_000_000,
  fxDate: "2026-05-17",
  isCustomRate: false,
  settlementAmount: 300,
  payers: [{ memberId: "a", amountMinor: 300 }],
  split: { method: "equal", participants: ["b", "a"] },
  expenseDate: "2026-05-17",
  expenseTime: null,
};

const stored: Expense = {
  id: "e1",
  groupId: "g1",
  creatorMemberId: "a",
  description: "晚餐",
  category: "餐飲",
  originalAmount: 300,
  originalCurrency: "TWD",
  fxRateScaled: 1_000_000,
  fxDate: "2026-05-17",
  isCustomRate: false,
  settlementAmount: 300,
  splitMethod: "equal",
  payers: [{ memberId: "a", amountMinor: 300, settlementAmount: 300 }],
  splits: [
    { memberId: "a", shares: null, amountMinor: 150, settlementAmount: 150 },
    { memberId: "b", shares: null, amountMinor: 150, settlementAmount: 150 },
  ],
  expenseDate: "2026-05-17",
  expenseTime: null,
  stopId: null,
  createdAt: 1,
  updatedAt: 2,
};

describe("sameEdit", () => {
  it("recognises an edit the server already holds, whatever the order of members", () => {
    expect(sameEdit(input, stored)).toBe(true);
  });

  it("does not mistake someone else's different edit for ours", () => {
    expect(sameEdit(input, { ...stored, description: "宵夜" })).toBe(false);
    expect(sameEdit(input, { ...stored, originalAmount: 301 })).toBe(false);
    expect(sameEdit(input, { ...stored, expenseTime: "19:30" })).toBe(false);
    expect(
      sameEdit(input, {
        ...stored,
        payers: [{ memberId: "b", amountMinor: 300, settlementAmount: 300 }],
      }),
    ).toBe(false);
    expect(sameEdit(input, { ...stored, splits: stored.splits.slice(0, 1) })).toBe(false);
  });

  it("compares shares and exact amounts line by line", () => {
    const shares: ExpenseInput = {
      ...input,
      split: {
        method: "shares",
        lines: [
          { memberId: "a", shares: 1 },
          { memberId: "b", shares: 2 },
        ],
      },
    };
    const held: Expense = {
      ...stored,
      splitMethod: "shares",
      splits: [
        { memberId: "a", shares: 1, amountMinor: 100, settlementAmount: 100 },
        { memberId: "b", shares: 2, amountMinor: 200, settlementAmount: 200 },
      ],
    };
    expect(sameEdit(shares, held)).toBe(true);
    expect(
      sameEdit(shares, {
        ...held,
        splits: held.splits.map((s) => ({ ...s, shares: s.memberId === "a" ? 2 : 1 })),
      }),
    ).toBe(false);
    const exact: ExpenseInput = {
      ...input,
      split: {
        method: "exact",
        lines: [
          { memberId: "a", amountMinor: 100 },
          { memberId: "b", amountMinor: 200 },
        ],
      },
    };
    expect(sameEdit(exact, { ...held, splitMethod: "exact" })).toBe(true);
    expect(sameEdit(exact, stored)).toBe(false);
  });
});
