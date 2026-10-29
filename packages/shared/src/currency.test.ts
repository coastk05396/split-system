import { describe, expect, it } from "vitest";
import { formatAmount, isValidExpenseAmount, minorToDecimal, parseAmount } from "./currency.js";

describe("parseAmount", () => {
  it("reads TWD as whole dollars", () => {
    expect(parseAmount("2160", "TWD")).toEqual({ ok: true, value: 2160 });
  });

  it("reads USD as cents", () => {
    expect(parseAmount("12.34", "USD")).toEqual({ ok: true, value: 1234 });
    expect(parseAmount("12.3", "USD")).toEqual({ ok: true, value: 1230 });
    expect(parseAmount("12", "USD")).toEqual({ ok: true, value: 1200 });
  });

  it("rejects more decimals than the currency has", () => {
    expect(parseAmount("12.5", "TWD")).toEqual({ ok: false, error: "AMOUNT_INVALID" });
    expect(parseAmount("12.345", "USD")).toEqual({ ok: false, error: "AMOUNT_INVALID" });
  });

  it("rejects text that is not a plain non-negative number", () => {
    for (const text of ["", "-5", "1e3", "abc", "1,000", " 12", "12."]) {
      expect(parseAmount(text, "TWD")).toEqual({ ok: false, error: "AMOUNT_INVALID" });
    }
  });
});

describe("formatAmount", () => {
  it("shows TWD with its symbol and thousands separators", () => {
    expect(formatAmount(2160, "TWD")).toBe("NT$ 2,160");
  });

  it("shows USD cents with two decimals", () => {
    expect(formatAmount(1234, "USD")).toBe("US$ 12.34");
    expect(formatAmount(99_999_999, "USD")).toBe("US$ 999,999.99");
    expect(formatAmount(5, "USD")).toBe("US$ 0.05");
  });

  it("puts the minus sign in front of the symbol", () => {
    expect(formatAmount(-293, "TWD")).toBe("-NT$ 293");
  });
});

describe("isValidExpenseAmount", () => {
  it("accepts 1 to 99,999,999 units", () => {
    expect(isValidExpenseAmount(1)).toBe(true);
    expect(isValidExpenseAmount(99_999_999)).toBe(true);
  });

  it("rejects zero, negatives, fractions and anything above the cap", () => {
    for (const n of [0, -1, 1.5, 100_000_000, Number.NaN]) {
      expect(isValidExpenseAmount(n)).toBe(false);
    }
  });
});

describe("minorToDecimal", () => {
  it("formats TWD as integer string", () => {
    expect(minorToDecimal(2160, "TWD")).toBe("2160");
    expect(minorToDecimal(-50, "TWD")).toBe("-50");
  });

  it("formats USD cents as decimal string with sign", () => {
    expect(minorToDecimal(1234, "USD")).toBe("12.34");
    expect(minorToDecimal(5, "USD")).toBe("0.05");
    expect(minorToDecimal(-1250, "USD")).toBe("-12.50");
    expect(minorToDecimal(0, "USD")).toBe("0.00");
  });
});
