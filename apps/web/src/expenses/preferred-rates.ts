import type { CurrencyCode } from "@split/shared";
import { useRates } from "./api.js";
import { localNow } from "./expense-draft.js";

/** Reference rates and dates needed to display amounts in a User's Preferred currency. */
export function usePreferredRates(preferred: CurrencyCode, currencies: readonly CurrencyCode[]) {
  const bases = [...new Set(currencies.filter((currency) => currency !== preferred))];
  const today = localNow(new Date()).date;
  const queries = useRates(today, preferred, bases);
  const rates = new Map(
    bases.flatMap((base, i) => {
      const rate = queries[i]?.data;
      return rate === undefined ? [] : [[base, rate.rateScaled] as const];
    }),
  );
  const dates = [
    ...new Set(queries.flatMap((query) => (query.data === undefined ? [] : [query.data.rateDate]))),
  ].sort();
  return {
    today,
    rates,
    dates,
    pending: queries.some((query) => query.isPending),
    unavailable: queries.some((query) => query.isError),
    retry: () => {
      for (const query of queries) void query.refetch();
    },
  };
}
