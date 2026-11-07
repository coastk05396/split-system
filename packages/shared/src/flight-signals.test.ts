import fc from "fast-check";
import { expect, it } from "vitest";
import { evaluateDealSignal } from "./flight-signals.js";
it("unlocks actual historical comparisons only at fourteen daily snapshots", () => {
  expect(
    evaluateDealSignal({
      price: 8500,
      priceLevel: "unknown",
      history: Array<number>(13).fill(10000),
    }),
  ).toEqual({ signal: "hold", overBudget: 0, history: null });
  expect(
    evaluateDealSignal({
      price: 8500,
      priceLevel: "unknown",
      history: Array<number>(14).fill(10000),
    }),
  ).toMatchObject({
    signal: "strong_buy",
    history: { days: 14, percentBelowMean: 15, percentile: 0 },
  });
  expect(
    evaluateDealSignal({
      price: 11500,
      priceLevel: "unknown",
      history: Array<number>(14).fill(10000),
    }).signal,
  ).toBe("buy");
  expect(
    evaluateDealSignal({ price: 11501, priceLevel: "low", history: Array<number>(14).fill(10000) })
      .signal,
  ).toBe("hold");
  expect(
    evaluateDealSignal({ price: 1000, budget: 999, priceLevel: "low", history: [] }),
  ).toMatchObject({ signal: "hold", overBudget: 1, history: null });
});

it("never lets native or historic bargains override the user's budget or time rules", () => {
  const history = Array<number>(14).fill(10000);
  for (const priceLevel of ["low", "typical", "high", "unknown"] as const) {
    expect(evaluateDealSignal({ price: 1000, priceLevel, budget: 999, history }).signal).toBe(
      "hold",
    );
    expect(
      evaluateDealSignal({ price: 1000, priceLevel, meetsTimeRules: false, history }).signal,
    ).toBe("hold");
  }
  expect(evaluateDealSignal({ price: 8500, priceLevel: "high", history }).signal).toBe("hold");
});

it("never emits statistics for an immature route or approves an over-budget fare", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 99_999_999 }),
      fc.integer({ min: 0, max: 13 }),
      (price, days) => {
        const evaluated = evaluateDealSignal({
          price,
          priceLevel: "low",
          budget: price - 1,
          history: Array<number>(days).fill(price),
        });
        expect(evaluated.history).toBeNull();
        expect(evaluated.signal).toBe("hold");
        expect(evaluated.overBudget).toBe(1);
      },
    ),
  );
});
