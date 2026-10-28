import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { splitEqual, splitExact, splitShares } from "./split.js";
import { MAX_AMOUNT_MINOR } from "./currency.js";

const amounts = (lines: readonly { amountMinor: number }[]) => lines.map((l) => l.amountMinor);

describe("splitEqual", () => {
  it("gives NT$100 over three people with the payer taking part as 34 / 33 / 33", () => {
    const result = splitEqual(100, ["a", "b", "c"], ["a"]);
    expect(result).toEqual({
      ok: true,
      value: [
        { memberId: "a", amountMinor: 34 },
        { memberId: "b", amountMinor: 33 },
        { memberId: "c", amountMinor: 33 },
      ],
    });
  });

  it("hands the leftover to the payer first even when they are not first in member order", () => {
    const result = splitEqual(101, ["a", "b", "c"], ["c"]);
    expect(result.ok && amounts(result.value)).toEqual([34, 33, 34]);
  });

  it("skips a payer who does not take part and follows member order", () => {
    const result = splitEqual(101, ["a", "b", "c"], ["z"]);
    expect(result.ok && amounts(result.value)).toEqual([34, 34, 33]);
  });

  it("with several payers, the participating payers take leftovers first in member order", () => {
    const result = splitEqual(102, ["a", "b", "c", "d"], ["d", "b"]);
    expect(result.ok && amounts(result.value)).toEqual([25, 26, 25, 26]);
  });

  it("needs at least one participant, each named once", () => {
    expect(splitEqual(100, [], ["a"])).toEqual({ ok: false, error: "SPLIT_NO_PARTICIPANTS" });
    expect(splitEqual(100, ["a", "a"], ["a"])).toEqual({
      ok: false,
      error: "SPLIT_DUPLICATE_MEMBER",
    });
  });

  it("rejects totals outside the Expense bounds", () => {
    expect(splitEqual(0, ["a"], ["a"])).toEqual({ ok: false, error: "EXPENSE_AMOUNT_INVALID" });
  });
});

describe("splitShares", () => {
  it("divides by weight and hands leftovers by the same rule", () => {
    // 100 * 2/4 = 50, 100 * 1/4 = 25, 25 -> exact, no leftover
    const even = splitShares(
      100,
      [
        { memberId: "a", shares: 2 },
        { memberId: "b", shares: 1 },
        { memberId: "c", shares: 1 },
      ],
      ["a"],
    );
    expect(even.ok && amounts(even.value)).toEqual([50, 25, 25]);

    // 10 * 1/3 = 3.33 floors to 3, 10 * 2/3 = 6.67 floors to 6; one leftover to payer b
    const leftover = splitShares(
      10,
      [
        { memberId: "a", shares: 1 },
        { memberId: "b", shares: 2 },
      ],
      ["b"],
    );
    expect(leftover.ok && amounts(leftover.value)).toEqual([3, 7]);
  });

  it("accepts whole shares from 1 to 99 only", () => {
    for (const shares of [0, 100, 1.5]) {
      expect(splitShares(100, [{ memberId: "a", shares }], ["a"])).toEqual({
        ok: false,
        error: "SPLIT_SHARES_INVALID",
      });
    }
  });
});

describe("splitExact", () => {
  it("keeps the typed amounts when they add up to the total", () => {
    const result = splitExact(100, [
      { memberId: "a", amountMinor: 70 },
      { memberId: "b", amountMinor: 30 },
    ]);
    expect(result.ok && amounts(result.value)).toEqual([70, 30]);
  });

  it("never balances automatically: a mismatch is an error", () => {
    expect(
      splitExact(100, [
        { memberId: "a", amountMinor: 70 },
        { memberId: "b", amountMinor: 20 },
      ]),
    ).toEqual({ ok: false, error: "SPLIT_SUM_MISMATCH" });
  });

  it("rejects negative or fractional lines", () => {
    expect(
      splitExact(100, [
        { memberId: "a", amountMinor: -1 },
        { memberId: "b", amountMinor: 101 },
      ]),
    ).toEqual({ ok: false, error: "SPLIT_AMOUNT_INVALID" });
  });
});

const memberIds = fc.uniqueArray(fc.stringMatching(/^[a-z]{1,4}$/), {
  minLength: 1,
  maxLength: 30,
});
const total = fc.integer({ min: 1, max: MAX_AMOUNT_MINOR });

describe("split properties", () => {
  it("equal: lines sum to the total, each within 1 unit of fair, same input same output", () => {
    fc.assert(
      fc.property(
        total,
        memberIds,
        fc.array(fc.stringMatching(/^[a-z]{1,4}$/)),
        (t, ids, payers) => {
          const result = splitEqual(t, ids, payers);
          if (!result.ok) return false;
          const values = amounts(result.value);
          const fair = t / ids.length;
          expect(values.reduce((s, v) => s + v, 0)).toBe(t);
          for (const v of values) expect(Math.abs(v - fair)).toBeLessThan(1);
          expect(splitEqual(t, ids, payers)).toEqual(result);
          return true;
        },
      ),
    );
  });

  it("shares: lines sum to the total and each is within 1 unit of its weighted fair amount", () => {
    fc.assert(
      fc.property(
        total,
        memberIds.chain((ids) =>
          fc.tuple(
            fc.constant(ids),
            fc.array(fc.integer({ min: 1, max: 99 }), {
              minLength: ids.length,
              maxLength: ids.length,
            }),
          ),
        ),
        (t, [ids, weights]) => {
          const lines = ids.map((memberId, i) => ({ memberId, shares: weights[i] ?? 1 }));
          const result = splitShares(t, lines, [ids[0] ?? ""]);
          if (!result.ok) return false;
          const sumW = weights.reduce((s, w) => s + w, 0);
          const values = amounts(result.value);
          expect(values.reduce((s, v) => s + v, 0)).toBe(t);
          values.forEach((v, i) => {
            expect(Math.abs(v - (t * (weights[i] ?? 0)) / sumW)).toBeLessThan(1);
          });
          expect(splitShares(t, lines, [ids[0] ?? ""])).toEqual(result);
          return true;
        },
      ),
    );
  });
});
