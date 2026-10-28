import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { convertLines, validatePayers } from "./payers.js";

describe("validatePayers", () => {
  it("accepts one payer paying the whole Expense", () => {
    expect(validatePayers(2160, [{ memberId: "a", amountMinor: 2160 }])).toEqual({
      ok: true,
      value: [{ memberId: "a", amountMinor: 2160 }],
    });
  });

  it("accepts several payers whose amounts add up to the total", () => {
    const result = validatePayers(1000, [
      { memberId: "a", amountMinor: 600 },
      { memberId: "b", amountMinor: 400 },
    ]);
    expect(result.ok).toBe(true);
  });

  it("rejects payers that do not add up, repeat, pay nothing, or are missing", () => {
    expect(validatePayers(1000, [{ memberId: "a", amountMinor: 900 }])).toEqual({
      ok: false,
      error: "PAYERS_SUM_MISMATCH",
    });
    expect(
      validatePayers(1000, [
        { memberId: "a", amountMinor: 500 },
        { memberId: "a", amountMinor: 500 },
      ]),
    ).toEqual({ ok: false, error: "PAYER_DUPLICATE_MEMBER" });
    expect(
      validatePayers(1000, [
        { memberId: "a", amountMinor: 1000 },
        { memberId: "b", amountMinor: 0 },
      ]),
    ).toEqual({ ok: false, error: "PAYER_AMOUNT_INVALID" });
    expect(validatePayers(1000, [])).toEqual({ ok: false, error: "PAYERS_EMPTY" });
  });
});

describe("convertLines", () => {
  it("converts each line so the converted lines add up to the converted total exactly", () => {
    // US$ 10.00 split 3 ways is 334 / 333 / 333 cents; converted total NT$ 315
    const result = convertLines(
      [
        { memberId: "a", amountMinor: 334 },
        { memberId: "b", amountMinor: 333 },
        { memberId: "c", amountMinor: 333 },
      ],
      315,
      ["a"],
    );
    // 315 * 334/1000 = 105.21 -> 105, 315 * 333/1000 = 104.895 -> 104 (x2); leftover 2: a, then b
    expect(result.map((l) => l.amountMinor)).toEqual([106, 105, 104]);
  });

  it("always sums to the converted total", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 99_999_999 }), { minLength: 1, maxLength: 30 }),
        fc.integer({ min: 1, max: 99_999_999 }),
        (values, converted) => {
          fc.pre(values.some((v) => v > 0));
          const lines = values.map((amountMinor, i) => ({ memberId: `m${i}`, amountMinor }));
          const result = convertLines(lines, converted, ["m0"]);
          expect(result.reduce((s, l) => s + l.amountMinor, 0)).toBe(converted);
        },
      ),
    );
  });
});
