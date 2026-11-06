import type { CurrencyCode, Expense, ExpensePage, Rate, Stop } from "@split/shared";
import { useInfiniteQuery, useQueries, useQuery } from "@tanstack/react-query";
import { abortable, expenseKeys, readWithRev as read, useGroupData } from "../groups/data.js";

/** TanStack Query hooks over the Worker's Expense, Rate and Stop routes (SPEC §5.1). */

/** Routes whose query string the typed client cannot describe are called by path. */
const path = (base: string, query: Record<string, string | undefined>) => {
  const params = new URLSearchParams(
    Object.entries(query).filter((e): e is [string, string] => e[1] !== undefined),
  );
  const text = params.toString();
  return text === "" ? base : `${base}?${text}`;
};

/** A Group's Expenses, newest first, 50 a page. */
export function useExpenses(groupId: string) {
  const { fetch } = useGroupData();
  return useInfiniteQuery({
    queryKey: expenseKeys.list(groupId),
    initialPageParam: undefined as string | undefined,
    queryFn: (ctx) =>
      read<ExpensePage>(
        fetch(
          path(`/api/v1/groups/${encodeURIComponent(groupId)}/expenses`, { cursor: ctx.pageParam }),
          abortable(ctx),
        ),
        ctx,
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

export function useExpense(groupId: string, expenseId: string) {
  const { api } = useGroupData();
  return useQuery({
    queryKey: expenseKeys.one(groupId, expenseId),
    queryFn: (ctx) =>
      read<Expense>(
        api.groups[":id"].expenses[":eid"].$get(
          { param: { id: groupId, eid: expenseId } },
          { init: abortable(ctx) },
        ),
        ctx,
      ),
  });
}

/** The reference Exchange rate for a day, or nothing when both currencies are the same. */
export function useRate(date: string, base: CurrencyCode, quote: CurrencyCode) {
  const { fetch } = useGroupData();
  return useQuery({
    queryKey: expenseKeys.rate(date, base, quote),
    enabled: base !== quote && date !== "",
    retry: false,
    staleTime: 60 * 60 * 1000,
    queryFn: () => read<Rate>(fetch(path("/api/v1/rates", { date, base, quote }))),
  });
}

/** The reference rates from each of `bases` into `quote` for one day, in the order of `bases`. */
export function useRates(date: string, quote: CurrencyCode, bases: readonly CurrencyCode[]) {
  const { fetch } = useGroupData();
  return useQueries({
    queries: bases.map((base) => ({
      queryKey: expenseKeys.rate(date, base, quote),
      enabled: base !== quote && date !== "",
      retry: false,
      staleTime: 60 * 60 * 1000,
      queryFn: () => read<Rate>(fetch(path("/api/v1/rates", { date, base, quote }))),
    })),
  });
}

/** A Trip's Stops on one day, for the Expense's Stop link. */
export function useStops(groupId: string, day: string, enabled: boolean) {
  const { fetch } = useGroupData();
  return useQuery({
    queryKey: expenseKeys.stops(groupId, day),
    enabled: enabled && day !== "",
    queryFn: () =>
      read<Stop[]>(fetch(path(`/api/v1/groups/${encodeURIComponent(groupId)}/stops`, { day }))),
  });
}
