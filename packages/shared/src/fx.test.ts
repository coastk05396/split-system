import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  convertAmount,
  convertBalance,
  deriveRateScaled,
  formatRate,
  parseRate,
  RATE_SCALE,
} from "./fx.js";

describe("convertAmount", () => {
  it("converts US$ 12.34 at 31.5234 to a whole NT$ 389", () => {
    expect(convertAmount(1234, "USD", "TWD", 31_523_400)).toEqual({ ok: true, value: 389 });
  });

  it("converts NT$ 2,160 at 0.031723 to US$ 68.52", () => {
    expect(convertAmount(2160, "TWD", "USD", 31_723)).toEqual({ ok: true, value: 6852 });
  });

  it("rounds a half unit away from zero", () => {
    expect(convertAmount(1, "USD", "TWD", 50_000_000)).toEqual({ ok: true, value: 1 });
  });

  it("keeps a same-currency amount and needs the rate to be exactly 1", () => {
    expect(convertAmount(2160, "TWD", "TWD", RATE_SCALE)).toEqual({ ok: true, value: 2160 });
    expect(convertAmount(2160, "TWD", "TWD", 2 * RATE_SCALE)).toEqual({
      ok: false,
      error: "RATE_INVALID",
    });
  });

  it("rejects a non-positive rate and a converted amount outside the Expense bounds", () => {
    expect(convertAmount(1234, "USD", "TWD", 0)).toEqual({ ok: false, error: "RATE_INVALID" });
    expect(convertAmount(1, "USD", "TWD", 31_523_400)).toEqual({
      ok: false,
      error: "EXPENSE_AMOUNT_INVALID",
    });
  });
});

describe("deriveRateScaled", () => {
  it("derives the rate from a typed converted amount", () => {
    // 389 / 12.34 = 31.5235008...
    expect(deriveRateScaled(1234, "USD", 389, "TWD")).toEqual({ ok: true, value: 31_523_501 });
  });

  it("rejects amounts outside the Expense bounds", () => {
    expect(deriveRateScaled(1234, "USD", 0, "TWD")).toEqual({
      ok: false,
      error: "EXPENSE_AMOUNT_INVALID",
    });
  });

  // The rate is rounded to 6 decimals, so above about US$ 10,000 the round trip can be off by
  // one; the typed converted amount stays the authority and is stored as typed.
  it("gives a rate that converts back to the typed amount up to US$ 10,000", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 1_000_000 }),
        fc.integer({ min: 100, max: 99_999_999 }),
        (usdCents, twd) => {
          const rate = deriveRateScaled(usdCents, "USD", twd, "TWD");
          fc.pre(rate.ok && rate.value > 0);
          expect(convertAmount(usdCents, "USD", "TWD", rate.value)).toEqual({
            ok: true,
            value: twd,
          });
        },
      ),
    );
  });
});

describe("formatRate and parseRate", () => {
  it("shows a scaled rate to four decimals", () => {
    expect(formatRate(31_523_400)).toBe("31.5234");
    expect(formatRate(31_523_450)).toBe("31.5235");
    expect(formatRate(31_723)).toBe("0.031723");
    expect(formatRate(31_700)).toBe("0.0317");
    expect(formatRate(6_543)).toBe("0.006543");
  });

  it("reads a typed custom rate into the scaled integer", () => {
    expect(parseRate("31.5234")).toEqual({ ok: true, value: 31_523_400 });
    expect(parseRate("1")).toEqual({ ok: true, value: RATE_SCALE });
    for (const text of ["0", "", "-1", "1.1234567", "abc"]) {
      expect(parseRate(text)).toEqual({ ok: false, error: "RATE_INVALID" });
    }
  });
});

describe("convertBalance", () => {
  it("converts a Balance far above the single-Expense cap, in either sign", () => {
    // 120,000,000 JPY at 0.21 TWD each is NT$ 25,200,000; the Expense cap is 99,999,999.
    expect(convertBalance(120_000_000, "JPY", "TWD", 210_000)).toEqual({
      ok: true,
      value: 25_200_000,
    });
    expect(convertBalance(-120_000_000, "JPY", "TWD", 210_000)).toEqual({
      ok: true,
      value: -25_200_000,
    });
  });

  it("rounds to the target's smallest unit and lets a sliver become zero", () => {
    expect(convertBalance(1, "JPY", "TWD", 215_000)).toEqual({ ok: true, value: 0 });
    expect(convertBalance(0, "JPY", "TWD", 215_000)).toEqual({ ok: true, value: 0 });
    // US$ 12.50 at 31.5234 is NT$ 394.0425, rounded to NT$ 394.
    expect(convertBalance(1250, "USD", "TWD", 31_523_400)).toEqual({ ok: true, value: 394 });
  });

  it("keeps a Balance in its own currency as it is", () => {
    expect(convertBalance(-293, "TWD", "TWD", RATE_SCALE)).toEqual({ ok: true, value: -293 });
  });

  it("refuses an unusable rate or a result too large to hold exactly", () => {
    expect(convertBalance(100, "USD", "TWD", 0)).toEqual({ ok: false, error: "RATE_INVALID" });
    expect(convertBalance(Number.MAX_SAFE_INTEGER, "USD", "JPY", 9_000_000_000)).toEqual({
      ok: false,
      error: "AMOUNT_INVALID",
    });
  });
});
