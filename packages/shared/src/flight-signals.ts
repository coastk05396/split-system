import type { DealSignal, FlightFare } from "./flights.js";

export interface FareHistoryStats {
  days: number;
  meanPrice: number;
  percentBelowMean: number;
  percentile: number;
}

/** History is one observed minimum per distinct day in the same route/currency/window bucket. */
export function evaluateDealSignal(input: {
  price: number;
  priceLevel: FlightFare["priceLevel"];
  budget?: number;
  history: readonly number[];
  meetsTimeRules?: boolean;
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
  return { signal, overBudget, history };
}
