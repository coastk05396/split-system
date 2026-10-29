import { describe, expect, it } from "vitest";
import { evaluateAmount } from "./calculator.js";

describe("evaluateAmount", () => {
  it("adds, subtracts, multiplies and divides with the usual precedence", () => {
    expect(evaluateAmount("120+80", "TWD")).toEqual({ ok: true, value: 200 });
    expect(evaluateAmount("2+3*4", "TWD")).toEqual({ ok: true, value: 14 });
    expect(evaluateAmount("(2+3)*4", "TWD")).toEqual({ ok: true, value: 20 });
    expect(evaluateAmount("100-40/2", "TWD")).toEqual({ ok: true, value: 80 });
    expect(evaluateAmount("10-3-2", "TWD")).toEqual({ ok: true, value: 5 });
    expect(evaluateAmount("2160", "TWD")).toEqual({ ok: true, value: 2160 });
  });

  it("works in minor units without floating-point drift", () => {
    expect(evaluateAmount("0.1+0.2", "USD")).toEqual({ ok: true, value: 30 });
    expect(evaluateAmount("12.34*3", "USD")).toEqual({ ok: true, value: 3702 });
  });

  it("rounds the result to the currency's smallest unit", () => {
    expect(evaluateAmount("100/3", "TWD")).toEqual({ ok: true, value: 33 });
    expect(evaluateAmount("10/3", "USD")).toEqual({ ok: true, value: 333 });
    expect(evaluateAmount("5/2", "TWD")).toEqual({ ok: true, value: 3 });
  });

  it("rejects anything but digits, a decimal point, + - * / and parentheses", () => {
    for (const text of [
      "alert(1)",
      "1e3",
      "2**3",
      "1 + 1",
      "Math.PI",
      "1,000",
      "3×4",
      "1;2",
      "0x10",
    ]) {
      expect(evaluateAmount(text, "TWD")).toEqual({ ok: false, error: "EXPRESSION_INVALID" });
    }
  });

  it("rejects malformed arithmetic", () => {
    for (const text of ["", "1+", "*2", "(1+2", "1+2)", "()", "1..2", ".", "-5", "1+-2", "2(3)"]) {
      expect(evaluateAmount(text, "TWD")).toEqual({ ok: false, error: "EXPRESSION_INVALID" });
    }
  });

  it("treats division by zero as an error", () => {
    expect(evaluateAmount("5/0", "TWD")).toEqual({ ok: false, error: "DIVISION_BY_ZERO" });
    expect(evaluateAmount("5/(2-2)", "TWD")).toEqual({ ok: false, error: "DIVISION_BY_ZERO" });
  });

  it("treats results outside 1 to 99,999,999 units as errors", () => {
    expect(evaluateAmount("5-5", "TWD")).toEqual({ ok: false, error: "EXPENSE_AMOUNT_INVALID" });
    expect(evaluateAmount("5-10", "TWD")).toEqual({ ok: false, error: "EXPENSE_AMOUNT_INVALID" });
    expect(evaluateAmount("99999999+1", "TWD")).toEqual({
      ok: false,
      error: "EXPENSE_AMOUNT_INVALID",
    });
    expect(evaluateAmount("0.001", "USD")).toEqual({ ok: false, error: "EXPENSE_AMOUNT_INVALID" });
  });

  it("refuses very long input rather than evaluating it", () => {
    expect(evaluateAmount("1+".repeat(200) + "1", "TWD")).toEqual({
      ok: false,
      error: "EXPRESSION_INVALID",
    });
  });
});
