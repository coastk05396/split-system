import fc from "fast-check";
import { expect, it } from "vitest";
import { cheapestThirdCutoff, evaluateDealSignal } from "./flight-signals.js";
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

it("raises Strong Buy for a top fare in the cheapest third of its search, and only for a top fare", () => {
  const typical = { priceLevel: "typical" as const, history: [] };
  // Nine fares: the cheapest third ends at the third-cheapest price (index ceil(9/3)-1 = 2).
  const prices = [100, 110, 120, 130, 140, 150, 160, 170, 180];
  expect(cheapestThirdCutoff(prices)).toBe(120);
  expect(cheapestThirdCutoff([180, 100, 120])).toBe(100);
  expect(cheapestThirdCutoff([50, 60])).toBe(50);
  expect(cheapestThirdCutoff([])).toBeUndefined();
  const at = (price: number, top: boolean) =>
    evaluateDealSignal({ ...typical, price, top, cheapestThird: 120 }).signal;
  expect(at(120, true)).toBe("strong_buy");
  expect(at(100, true)).toBe("strong_buy");
  expect(at(121, true)).toBe("buy");
  expect(at(100, false)).toBe("buy");
  // The history rule still raises it on its own, top or not.
  expect(
    evaluateDealSignal({
      price: 8500,
      priceLevel: "unknown",
      history: Array<number>(14).fill(10000),
    }).signal,
  ).toBe("strong_buy");
  // A budget the fare exceeds still wins.
  expect(
    evaluateDealSignal({ ...typical, price: 100, budget: 99, top: true, cheapestThird: 120 })
      .signal,
  ).toBe("hold");
});
