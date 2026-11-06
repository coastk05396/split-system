import type { CurrencyCode, Expense, ExpenseInput, ExpensePage, Rate, Stop } from "@split/shared";
import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { withJson } from "../api/client.js";
import { ApiFailure, toApiFailure } from "../api/errors.js";
import { failureMessage } from "../groups/ui.js";
import { t } from "../i18n/messages.js";
import { dismissDeleteFailure, reportDeleteFailure } from "./delete-failure.js";
import { sameEdit } from "./edit-reconcile.js";
import { currentEpoch, markDeleting, unmarkDeleting } from "./pending-writes.js";
import {
  abortable,
  expenseKeys,
  readWithRev as read,
  refreshGroup,
  useGroupData,
} from "../groups/data.js";

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

/**
 * Creates an Expense under the caller's `Idempotency-Key`, or edits one under
 * `If-Match: <updatedAt>`. A retried create must reuse its key so it cannot write twice.
 */
export function useSaveExpense(groupId: string) {
  const { api } = useGroupData();
  const client = useQueryClient();
  // A retry whose answer was lost meets EDIT_CONFLICT with its own edit already applied:
  // that is a success, not a conflict (the server has no idempotency key for edits).
  async function readEdit(input: ExpenseInput, expense: Expense): Promise<Expense> {
    const param = { id: groupId, eid: expense.id };
    try {
      return await read<Expense>(
        api.groups[":id"].expenses[":eid"].$patch(
          { param },
          withJson(input, { "If-Match": String(expense.updatedAt) }),
        ),
      );
    } catch (error) {
      if (!(error instanceof ApiFailure) || error.code !== "EDIT_CONFLICT") throw error;
      const held = await read<Expense>(api.groups[":id"].expenses[":eid"].$get({ param }));
      if (sameEdit(input, held)) return held;
      throw error;
    }
  }
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
              withJson(save.input, { "Idempotency-Key": save.idempotencyKey }),
            ),
          )
        : readEdit(save.input, save.expense),
    onMutate: () => ({ epoch: currentEpoch() }),
    onSuccess: (expense, _save, context) => {
      // Asked by an account that has since signed out: its answer belongs to nobody now.
      if (context.epoch !== currentEpoch()) return;
      client.setQueryData(expenseKeys.one(groupId, expense.id), expense);
      client.setQueryData<InfiniteData<ExpensePage>>(expenseKeys.list(groupId), (data) => {
        if (!data) return data;
        const exists = data.pages.some((p) => p.expenses.some((e) => e.id === expense.id));
        if (exists) return data;
        const [first, ...rest] = data.pages;
        if (!first) return data;
        return {
          ...data,
          pages: [{ ...first, expenses: [expense, ...first.expenses] }, ...rest],
        };
      });
      void refreshGroup(client, groupId);
    },
  });
}

export function useDeleteExpense(groupId: string) {
  const { api } = useGroupData();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (expenseId: string) => {
      const res: Response = await api.groups[":id"].expenses[":eid"].$delete({
        param: { id: groupId, eid: expenseId },
      });
      if (!res.ok) throw await toApiFailure(res);
    },
    // The row is hidden by the list while the delete is pending, so a refetch cannot bring it back.
    onMutate: (expenseId) => {
      dismissDeleteFailure();
      markDeleting(groupId, expenseId);
      return { epoch: currentEpoch() };
    },
    onError: (error, expenseId, context) => {
      if (context?.epoch !== currentEpoch()) return;
      unmarkDeleting(groupId, expenseId);
      reportDeleteFailure(groupId, t("expense.deleteFailed", { reason: failureMessage(error) }));
      void refreshGroup(client, groupId);
    },
    onSuccess: (_, expenseId, context) => {
      if (context.epoch !== currentEpoch()) return;
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
      unmarkDeleting(groupId, expenseId);
      void refreshGroup(client, groupId);
    },
  });
}
