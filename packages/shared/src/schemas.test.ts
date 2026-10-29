import { describe, expect, it } from "vitest";
import {
  expenseInputSchema,
  groupInputSchema,
  settlementInputSchema,
  stopInputSchema,
} from "./schemas.js";

const validExpense = {
  description: "晚餐",
  category: "餐飲",
  originalAmount: 2160,
  originalCurrency: "TWD",
  fxRateScaled: 1_000_000,
  fxDate: "2026-06-13",
  isCustomRate: false,
  settlementAmount: 2160,
  payers: [{ memberId: "a", amountMinor: 2160 }],
  split: { method: "equal", participants: ["a", "b", "c", "d"] },
  expenseDate: "2026-06-13",
  expenseTime: "19:30",
};

const issueCodes = (input: unknown): string[] => {
  const result = expenseInputSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => i.message);
};

describe("expenseInputSchema", () => {
  it("accepts a TWD dinner split equally four ways", () => {
    expect(expenseInputSchema.safeParse(validExpense).success).toBe(true);
  });

  it("accepts exact and shares splits and no time", () => {
    const { expenseTime: _omit, ...noTime } = validExpense;
    expect(
      expenseInputSchema.safeParse({
        ...noTime,
        split: {
          method: "exact",
          lines: [
            { memberId: "a", amountMinor: 2000 },
            { memberId: "b", amountMinor: 160 },
          ],
        },
      }).success,
    ).toBe(true);
    expect(
      expenseInputSchema.safeParse({
        ...validExpense,
        split: {
          method: "shares",
          lines: [
            { memberId: "a", shares: 2 },
            { memberId: "b", shares: 1 },
          ],
        },
      }).success,
    ).toBe(true);
  });

  it("rejects amounts outside 1 to 99,999,999 and non-integer amounts", () => {
    for (const originalAmount of [0, -1, 100_000_000, 12.5]) {
      expect(expenseInputSchema.safeParse({ ...validExpense, originalAmount }).success).toBe(false);
    }
  });

  it("rejects currencies the app does not ship and the removed percentage split", () => {
    expect(expenseInputSchema.safeParse({ ...validExpense, originalCurrency: "GBP" }).success).toBe(
      false,
    );
    expect(
      expenseInputSchema.safeParse({
        ...validExpense,
        split: { method: "percentage", lines: [{ memberId: "a", percent: 100 }] },
      }).success,
    ).toBe(false);
  });

  it("reports payers that do not add up to the amount", () => {
    expect(
      issueCodes({ ...validExpense, payers: [{ memberId: "a", amountMinor: 2000 }] }),
    ).toContain("PAYERS_SUM_MISMATCH");
  });

  it("reports exact lines that do not add up to the amount", () => {
    expect(
      issueCodes({
        ...validExpense,
        split: { method: "exact", lines: [{ memberId: "a", amountMinor: 100 }] },
      }),
    ).toContain("SPLIT_SUM_MISMATCH");
  });

  it("reports a participant named twice and shares outside 1 to 99", () => {
    expect(
      issueCodes({ ...validExpense, split: { method: "equal", participants: ["a", "a"] } }),
    ).toContain("SPLIT_DUPLICATE_MEMBER");
    expect(
      expenseInputSchema.safeParse({
        ...validExpense,
        split: { method: "shares", lines: [{ memberId: "a", shares: 100 }] },
      }).success,
    ).toBe(false);
  });

  it("rejects a non-positive rate", () => {
    expect(expenseInputSchema.safeParse({ ...validExpense, fxRateScaled: 0 }).success).toBe(false);
  });

  it("rejects malformed dates and times", () => {
    for (const patch of [
      { expenseDate: "2026-02-30" },
      { expenseDate: "13/06/2026" },
      { expenseTime: "24:00" },
      { fxDate: "2026-6-1" },
    ]) {
      expect(expenseInputSchema.safeParse({ ...validExpense, ...patch }).success).toBe(false);
    }
  });
});

describe("settlementInputSchema", () => {
  it("accepts a payment between two Members", () => {
    expect(
      settlementInputSchema.safeParse({ payerMemberId: "a", receiverMemberId: "b", amount: 540 })
        .success,
    ).toBe(true);
  });

  it("rejects paying yourself and a zero amount", () => {
    expect(
      settlementInputSchema.safeParse({ payerMemberId: "a", receiverMemberId: "a", amount: 540 })
        .success,
    ).toBe(false);
    expect(
      settlementInputSchema.safeParse({ payerMemberId: "a", receiverMemberId: "b", amount: 0 })
        .success,
    ).toBe(false);
  });
});

describe("groupInputSchema", () => {
  it("defaults to a TWD Running Tab", () => {
    expect(groupInputSchema.parse({ name: "室友" })).toEqual({
      name: "室友",
      settlementCurrency: "TWD",
      isTrip: false,
    });
  });

  it("accepts a Trip of at most 31 days that ends on or after it starts", () => {
    const trip = { name: "台南", isTrip: true, tripStartDate: "2026-07-01" };
    expect(groupInputSchema.safeParse({ ...trip, tripEndDate: "2026-07-31" }).success).toBe(true);
    expect(groupInputSchema.safeParse({ ...trip, tripEndDate: "2026-08-01" }).success).toBe(false);
    expect(groupInputSchema.safeParse({ ...trip, tripEndDate: "2026-06-30" }).success).toBe(false);
  });

  it("rejects a blank name", () => {
    expect(groupInputSchema.safeParse({ name: "   " }).success).toBe(false);
  });
});

describe("stopInputSchema", () => {
  it("accepts a Stop with or without a time range", () => {
    expect(
      stopInputSchema.safeParse({ dayDate: "2026-07-02", title: "赤崁樓", category: "景點" })
        .success,
    ).toBe(true);
    expect(
      stopInputSchema.safeParse({
        dayDate: "2026-07-02",
        startTime: "14:00",
        endTime: "15:30",
        title: "赤崁樓",
        category: "景點",
        locationName: "台南市中西區",
      }).success,
    ).toBe(true);
  });

  it("rejects an end time before the start time", () => {
    expect(
      stopInputSchema.safeParse({
        dayDate: "2026-07-02",
        startTime: "15:00",
        endTime: "14:00",
        title: "赤崁樓",
        category: "景點",
      }).success,
    ).toBe(false);
  });
});
