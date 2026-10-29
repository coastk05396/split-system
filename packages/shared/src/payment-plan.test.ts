import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  exactPayments,
  greedyPayments,
  planPayments,
  type Balance,
  type PlannedPayment,
} from "./payment-plan.js";

// Decision 07 worked example: greedy takes 4 payments, the optimum is 3.
const WORKED_EXAMPLE = [
  { memberId: "A", amountMinor: -6 },
  { memberId: "B", amountMinor: -5 },
  { memberId: "C", amountMinor: 2 },
  { memberId: "D", amountMinor: 4 },
  { memberId: "E", amountMinor: 5 },
];

describe("planPayments", () => {
  it("finds the fewest payments for the worked example and labels it exact", () => {
    const result = planPayments(WORKED_EXAMPLE);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.method).toBe("exact");
    expect(result.value.maxPayments).toBe(4);
    expect(result.value.payments).toEqual([
      { fromMemberId: "A", toMemberId: "D", amountMinor: 4 },
      { fromMemberId: "A", toMemberId: "C", amountMinor: 2 },
      { fromMemberId: "B", toMemberId: "E", amountMinor: 5 },
    ]);
  });

  it("falls back to greedy above 20 non-zero Balances and labels the N-1 bound", () => {
    // 21 debtors of 1 and one creditor of 21, plus zero Balances that are dropped
    const balances = [
      ...Array.from({ length: 21 }, (_, i) => ({ memberId: `d${i}`, amountMinor: -1 })),
      { memberId: "c", amountMinor: 21 },
      { memberId: "z", amountMinor: 0 },
    ];
    const result = planPayments(balances);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.method).toBe("greedy");
    expect(result.value.maxPayments).toBe(21);
    expect(result.value.payments).toHaveLength(21);
  });

  it("rejects Balances that do not sum to zero, repeat a Member, or are not whole units", () => {
    expect(
      planPayments([
        { memberId: "a", amountMinor: -5 },
        { memberId: "b", amountMinor: 4 },
      ]),
    ).toEqual({ ok: false, error: "BALANCES_SUM_NOT_ZERO" });
    expect(
      planPayments([
        { memberId: "a", amountMinor: -5 },
        { memberId: "a", amountMinor: 5 },
      ]),
    ).toEqual({ ok: false, error: "BALANCE_DUPLICATE_MEMBER" });
    expect(
      planPayments([
        { memberId: "a", amountMinor: -0.5 },
        { memberId: "b", amountMinor: 0.5 },
      ]),
    ).toEqual({ ok: false, error: "BALANCE_AMOUNT_INVALID" });
  });

  it("returns an empty exact plan when everyone is settled", () => {
    expect(planPayments([{ memberId: "a", amountMinor: 0 }])).toEqual({
      ok: true,
      value: { method: "exact", payments: [], maxPayments: 0 },
    });
  });
});

/** Zero-sum Balances for `m0..m{n-1}`; small amounts so zero-sum subgroups are common. */
const balancesArb = (maxLength: number, maxAmount = 12) =>
  fc
    .array(fc.integer({ min: -maxAmount, max: maxAmount }), {
      minLength: 1,
      maxLength: maxLength - 1,
    })
    .map((amounts) => {
      const all = [...amounts, -amounts.reduce((s, a) => s + a, 0)];
      return all.map((amountMinor, i) => ({ memberId: `m${i}`, amountMinor }));
    });

function applyPlan(balances: readonly Balance[], payments: readonly PlannedPayment[]) {
  const left = new Map(balances.map((b) => [b.memberId, b.amountMinor]));
  for (const p of payments) {
    expect(Number.isInteger(p.amountMinor) && p.amountMinor > 0).toBe(true);
    left.set(p.fromMemberId, (left.get(p.fromMemberId) ?? 0) + p.amountMinor);
    left.set(p.toMemberId, (left.get(p.toMemberId) ?? 0) - p.amountMinor);
  }
  return [...left.values()];
}

/** Oracle: fewest payments = N - (most zero-sum blocks over every set partition). */
function bruteForceFewest(balances: readonly Balance[]): number {
  const amounts = balances.map((b) => b.amountMinor).filter((a) => a !== 0);
  let mostBlocks = 0;
  const blocks: number[] = [];
  const visit = (i: number) => {
    if (i === amounts.length) {
      if (blocks.every((s) => s === 0)) mostBlocks = Math.max(mostBlocks, blocks.length);
      return;
    }
    const a = amounts[i] ?? 0;
    for (let k = 0; k < blocks.length; k++) {
      blocks[k] = (blocks[k] ?? 0) + a;
      visit(i + 1);
      blocks[k] = (blocks[k] ?? 0) - a;
    }
    blocks.push(a);
    visit(i + 1);
    blocks.pop();
  };
  visit(0);
  return amounts.length - mostBlocks;
}

describe("Payment plan properties", () => {
  it("applying the plan zeroes every Balance, on both the exact and greedy paths", () => {
    fc.assert(
      fc.property(balancesArb(26, 99_999), (balances) => {
        const result = planPayments(balances);
        if (!result.ok) throw new Error(result.error);
        expect(applyPlan(balances, result.value.payments).every((b) => b === 0)).toBe(true);
        expect(result.value.payments.length).toBeLessThanOrEqual(result.value.maxPayments);
      }),
      { numRuns: 200 },
    );
  });

  it("greedy alone zeroes every Balance within N-1 payments", () => {
    fc.assert(
      fc.property(balancesArb(40), (balances) => {
        const payments = greedyPayments(balances);
        expect(applyPlan(balances, payments).every((b) => b === 0)).toBe(true);
        const nonZero = balances.filter((b) => b.amountMinor !== 0).length;
        expect(payments.length).toBeLessThanOrEqual(Math.max(nonZero - 1, 0));
      }),
    );
  });

  it("exact never uses more payments than greedy", () => {
    fc.assert(
      fc.property(balancesArb(14), (balances) => {
        expect(exactPayments(balances).length).toBeLessThanOrEqual(greedyPayments(balances).length);
      }),
      { numRuns: 300 },
    );
  });

  it("exact matches a brute-force oracle on small inputs", () => {
    fc.assert(
      fc.property(balancesArb(8, 6), (balances) => {
        expect(exactPayments(balances).length).toBe(bruteForceFewest(balances));
      }),
      { numRuns: 500 },
    );
  });

  it("plans 20 random non-zero Balances in under 2 s", () => {
    // 10 debtors of at least 1,000,000 outweigh 9 creditors below 1,000,000, so the last is > 0
    const debts = fc.sample(fc.integer({ min: 1_000_000, max: 9_999_999 }), {
      numRuns: 10,
      seed: 7,
    });
    const credits = fc.sample(fc.integer({ min: 1, max: 999_999 }), { numRuns: 9, seed: 8 });
    const amounts = [...debts.map((d) => -d), ...credits];
    amounts.push(-amounts.reduce((s, a) => s + a, 0));
    const balances = amounts.map((amountMinor, i) => ({ memberId: `m${i}`, amountMinor }));
    const started = Date.now();
    const result = planPayments(balances);
    const elapsed = Date.now() - started;
    if (!result.ok) throw new Error(result.error);
    expect(result.value.method).toBe("exact");
    expect(elapsed).toBeLessThan(2000);
  });
});

describe("greedyPayments", () => {
  it("takes 4 payments on the worked example where 3 suffice", () => {
    expect(greedyPayments(WORKED_EXAMPLE)).toEqual([
      { fromMemberId: "A", toMemberId: "E", amountMinor: 5 },
      { fromMemberId: "B", toMemberId: "D", amountMinor: 4 },
      { fromMemberId: "A", toMemberId: "C", amountMinor: 1 },
      { fromMemberId: "B", toMemberId: "C", amountMinor: 1 },
    ]);
  });
});
