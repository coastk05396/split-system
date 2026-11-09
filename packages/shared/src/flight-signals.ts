import type { DealSignal, FlightFare } from "./flights.js";

export interface FareHistoryStats {
  days: number;
  meanPrice: number;
  percentBelowMean: number;
  percentile: number;
}

/**
 * The highest price still in the cheapest third of one search's fares: the price at index
 * ceil(n/3)-1 of the ascending prices. Undefined for an empty search.
 */
export function cheapestThirdCutoff(prices: readonly number[]): number | undefined {
  return [...prices].sort((a, b) => a - b)[Math.ceil(prices.length / 3) - 1];
}

/** History is one observed minimum per distinct day in the same route/currency/window bucket. */
export function evaluateDealSignal(input: {
  price: number;
  priceLevel: FlightFare["priceLevel"];
  budget?: number;
  history: readonly number[];
  meetsTimeRules?: boolean;
  /** Google listed the fare among its top flights. */
  top?: boolean;
  /** `cheapestThirdCutoff` of the fares of the same search. */
  cheapestThird?: number;
}): { signal: DealSignal; overBudget: number; history: FareHistoryStats | null } {
  const { price, priceLevel } = input;
  const overBudget = Math.max(0, price - (input.budget ?? price));
  const count = input.history.length;
  const mean = count ? input.history.reduce((sum, value) => sum + value, 0) / count : 0;
  const history =
    count < 14
      ? null
      : {
          days: count,
          meanPrice: mean,
          percentBelowMean: Math.round(((mean - price) / mean) * 1000) / 10,
          percentile:
            Math.round((input.history.filter((value) => value <= price).length / count) * 1000) /
            10,
        };
  let signal: DealSignal = "hold";
  if (
    overBudget > 0 ||
    input.meetsTimeRules === false ||
    priceLevel === "high" ||
    (history && price > mean * 1.15)
  )
    signal = "hold";
  else if (priceLevel === "low" || (history && (price <= mean * 0.85 || history.percentile <= 10)))
    signal = "strong_buy";
  else if (priceLevel === "typical" || (history && price >= mean * 0.85 && price <= mean * 1.15))
    signal = "buy";
  // A top fare in the cheapest third of its search is also Strong Buy, unless the budget or the
  // time rules rule it out (the same guards as every other bargain).
  if (
    signal !== "strong_buy" &&
    input.top === true &&
    input.cheapestThird !== undefined &&
    price <= input.cheapestThird &&
    overBudget === 0 &&
    input.meetsTimeRules !== false
  )
    signal = "strong_buy";
  return { signal, overBudget, history };
}
