import { describe, expect, it } from "vitest";
import { convertedTotal } from "./totals.js";

const rates = new Map([
  ["JPY", 210_000],
  ["USD", 31_523_400],
] as const);

describe("convertedTotal", () => {
  it("adds every currency, converted, into the Preferred currency", () => {
    const total = convertedTotal(
      [
        { currency: "TWD", amount: 393 },
        { currency: "USD", amount: 1250 },
        { currency: "JPY", amount: 0 },
        { currency: "THB", amount: 0 },
      ],
      "TWD",
      rates,
    );
    // NT$ 393 + US$ 12.50 at 31.5234 (NT$ 394).
    expect(total).toBe(787);
  });

  it("nets what is owed against what is due, across currencies", () => {
    const total = convertedTotal(
      [
        { currency: "TWD", amount: -1000 },
        { currency: "USD", amount: 5000 },
      ],
      "TWD",
      rates,
    );
    // US$ 50 is NT$ 1,576 (1,576.17 rounded).
    expect(total).toBe(576);
  });

  it("does not drop a Balance bigger than one Expense may be", () => {
    const total = convertedTotal(
      [
        { currency: "TWD", amount: 0 },
        { currency: "JPY", amount: 120_000_000 },
      ],
      "TWD",
      rates,
    );
    expect(total).toBe(25_200_000);
  });

  it("is null, not a smaller number, when a rate is missing", () => {
    const total = convertedTotal(
      [
        { currency: "TWD", amount: 100 },
        { currency: "THB", amount: 5000 },
      ],
      "TWD",
      rates,
    );
    expect(total).toBeNull();
  });
});
