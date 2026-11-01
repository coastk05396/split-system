import type { CurrencyCode, Expense, ExpenseInput, ExpensePage, Rate, Stop } from "@split/shared";
import {
  type InfiniteData,
  type QueryFunctionContext,
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useMemo } from "react";
import type { ClientRequestOptions } from "hono/client";
import { createApiClient } from "../api/client.js";
import { toApiFailure } from "../api/errors.js";
import { useAuth } from "../auth/AuthProvider.js";
import { groupKeys } from "../groups/api.js";
import { readWithRev } from "../groups/sync.js";

/** TanStack Query hooks over the Worker's Expense, Rate and Stop routes (SPEC §5.1). */

export const expenseKeys = {
  list: (groupId: string) => ["groups", groupId, "expenses"] as const,
  one: (groupId: string, expenseId: string) => ["groups", groupId, "expenses", expenseId] as const,
  stops: (groupId: string, day: string) => ["groups", groupId, "stops", day] as const,
  rate: (date: string, base: CurrencyCode, quote: CurrencyCode) =>
    ["rates", date, base, quote] as const,
};

function useSession() {
  const { session } = useAuth();
  return useMemo(() => ({ api: createApiClient(session.fetch), fetch: session.fetch }), [session]);
}

async function read<T>(call: Promise<Response>, context?: QueryFunctionContext): Promise<T> {
  return readWithRev<T>(call, context);
}

/** A JSON body plus headers; the Worker reads bodies itself, so the typed client has no input. */
function jsonWith(body: unknown, headers: Record<string, string>): ClientRequestOptions {
  return {
    init: {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", ...headers },
    },
  };
}

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
  const { fetch } = useSession();
  return useInfiniteQuery({
    queryKey: expenseKeys.list(groupId),
    initialPageParam: undefined as string | undefined,
    queryFn: (ctx) =>
      read<ExpensePage>(
        fetch(
          path(`/api/v1/groups/${encodeURIComponent(groupId)}/expenses`, { cursor: ctx.pageParam }),
        ),
        ctx,
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

export function useExpense(groupId: string, expenseId: string) {
  const { api } = useSession();
  return useQuery({
    queryKey: expenseKeys.one(groupId, expenseId),
    queryFn: (ctx) =>
      read<Expense>(
        api.groups[":id"].expenses[":eid"].$get({ param: { id: groupId, eid: expenseId } }),
        ctx,
      ),
  });
}

/** The reference Exchange rate for a day, or nothing when both currencies are the same. */
export function useRate(date: string, base: CurrencyCode, quote: CurrencyCode) {
  const { fetch } = useSession();
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
  const { fetch } = useSession();
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
  const { fetch } = useSession();
  return useQuery({
    queryKey: expenseKeys.stops(groupId, day),
    enabled: enabled && day !== "",
    queryFn: () =>
      read<Stop[]>(fetch(path(`/api/v1/groups/${encodeURIComponent(groupId)}/stops`, { day }))),
  });
}

/** Re-reads the Group (Balances, Members, Expenses) and the Group list after a write. */
function useRefresh(groupId: string) {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: groupKeys.group(groupId) }),
      client.invalidateQueries({ queryKey: groupKeys.all, exact: true }),
    ]);
}

/**
 * Creates an Expense under the caller's `Idempotency-Key`, or edits one under
 * `If-Match: <updatedAt>`. A retried create must reuse its key so it cannot write twice.
 */
export function useSaveExpense(groupId: string) {
  const { api } = useSession();
  const refresh = useRefresh(groupId);
  const client = useQueryClient();
  return useMutation({
    mutationFn: (
      save:
        | { kind: "create"; input: ExpenseInput; idempotencyKey: string }
        | { kind: "edit"; input: ExpenseInput; expense: Expense },
    ) =>
      save.kind === "create"
        ? read<Expense>(
            api.groups[":id"].expenses.$post(
              { param: { id: groupId } },
              jsonWith(save.input, { "Idempotency-Key": save.idempotencyKey }),
            ),
          )
        : read<Expense>(
            api.groups[":id"].expenses[":eid"].$patch(
              { param: { id: groupId, eid: save.expense.id } },
              jsonWith(save.input, { "If-Match": String(save.expense.updatedAt) }),
            ),
          ),
    onSuccess: async (expense) => {
      client.setQueryData(expenseKeys.one(groupId, expense.id), expense);
      await refresh();
    },
  });
}

export function useDeleteExpense(groupId: string) {
  const { api } = useSession();
  const refresh = useRefresh(groupId);
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (expenseId: string) => {
      const res: Response = await api.groups[":id"].expenses[":eid"].$delete({
        param: { id: groupId, eid: expenseId },
      });
      if (!res.ok) throw await toApiFailure(res);
    },
    onSuccess: async (_, expenseId) => {
      client.removeQueries({ queryKey: expenseKeys.one(groupId, expenseId) });
      client.setQueryData<InfiniteData<ExpensePage>>(expenseKeys.list(groupId), (data) =>
        data === undefined
          ? data
          : {
              ...data,
              pages: data.pages.map((p) => ({
                ...p,
                expenses: p.expenses.filter((e) => e.id !== expenseId),
              })),
            },
      );
      await refresh();
    },
  });
}
