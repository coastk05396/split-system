import type { Balances, Settlement, SettlementInput, SettlementPage } from "@split/shared";
import {
  type InfiniteData,
  type QueryClient,
  type QueryFunctionContext,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useMemo } from "react";
import type { ClientRequestOptions } from "hono/client";
import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/AuthProvider.js";
import { groupKeys } from "../groups/api.js";
import { abortable, invalidateStats, readWithRev } from "../groups/sync.js";

/** TanStack Query hooks over the Worker's Balance and Settlement routes (SPEC §5.1). */

export const settlementKeys = {
  balances: (groupId: string) => ["groups", groupId, "balances"] as const,
  list: (groupId: string) => ["groups", groupId, "settlements"] as const,
};

function useSession() {
  const { session } = useAuth();
  return useMemo(() => ({ api: createApiClient(session.fetch), fetch: session.fetch }), [session]);
}

async function read<T>(call: Promise<Response>, context?: QueryFunctionContext): Promise<T> {
  return readWithRev<T>(call, context);
}

function jsonWith(body: unknown, headers: Record<string, string> = {}): ClientRequestOptions {
  return {
    init: {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", ...headers },
    },
  };
}

export function useBalances(groupId: string) {
  const { api } = useSession();
  return useQuery({
    queryKey: settlementKeys.balances(groupId),
    queryFn: (ctx) =>
      read<Balances>(
        api.groups[":id"].balances.$get({ param: { id: groupId } }, { init: abortable(ctx) }),
        ctx,
      ),
  });
}

/** A Group's Settlements of every status, newest first, 50 a page. */
export function useSettlements(groupId: string) {
  const { fetch } = useSession();
  return useInfiniteQuery({
    queryKey: settlementKeys.list(groupId),
    initialPageParam: undefined as string | undefined,
    queryFn: (ctx) => {
      const base = `/api/v1/groups/${encodeURIComponent(groupId)}/settlements`;
      const url =
        ctx.pageParam === undefined ? base : `${base}?cursor=${encodeURIComponent(ctx.pageParam)}`;
      return read<SettlementPage>(fetch(url, abortable(ctx)), ctx);
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

/** Re-reads the Group (Balances, Members, Settlements) and the Group list after a write. */
function useRefresh(groupId: string) {
  const client = useQueryClient();
  return () =>
    Promise.all([
      invalidateStats(client),
      client.invalidateQueries({ queryKey: groupKeys.group(groupId) }),
      client.invalidateQueries({ queryKey: groupKeys.all, exact: true }),
    ]);
}

/**
 * Records a Settlement under the caller's `Idempotency-Key`. The Worker decides its status:
 * pending when the payer records it (我已付款), confirmed when the receiver or an Admin does.
 */
export function useRecordSettlement(groupId: string) {
  const { api } = useSession();
  const refresh = useRefresh(groupId);
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: SettlementInput; idempotencyKey: string }) =>
      read<Settlement>(
        api.groups[":id"].settlements.$post(
          { param: { id: groupId } },
          jsonWith(input, { "Idempotency-Key": idempotencyKey }),
        ),
      ),
    onMutate: async ({ input }) => {
      await client.cancelQueries({ queryKey: settlementKeys.balances(groupId) });
      const previousBalances = client.getQueryData<Balances>(settlementKeys.balances(groupId));
      if (previousBalances) {
        client.setQueryData<Balances>(settlementKeys.balances(groupId), {
          ...previousBalances,
          balances: previousBalances.balances.map((b) => {
            if (b.memberId === input.payerMemberId) {
              return { ...b, balance: b.balance + input.amount };
            }
            if (b.memberId === input.receiverMemberId) {
              return { ...b, balance: b.balance - input.amount };
            }
            return b;
          }),
        });
      }
      return { previousBalances };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousBalances) {
        client.setQueryData(settlementKeys.balances(groupId), context.previousBalances);
      }
    },
    onSettled: () => {
      void refresh();
    },
  });
}

function replaceSettlement(client: QueryClient, groupId: string, next: Settlement) {
  client.setQueryData<InfiniteData<SettlementPage>>(settlementKeys.list(groupId), (data) =>
    data === undefined
      ? data
      : {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            settlements: page.settlements.map((s) => (s.id === next.id ? next : s)),
          })),
        },
  );
}

export type SettlementAction = { kind: "undo"; settlementId: string };

/** Undo one confirmed Settlement. */
export function useSettlementAction(groupId: string) {
  const { api } = useSession();
  const client = useQueryClient();
  const refresh = useRefresh(groupId);
  return useMutation({
    mutationFn: (action: SettlementAction) => {
      const param = { param: { sid: action.settlementId } };
      return read<Settlement>(api.settlements[":sid"].undo.$post(param));
    },
    // Undo is the reverse of recording: the payer's balance drops and the receiver's rises by the
    // Settlement's amount. The row is marked undone at once, so it cannot be undone twice.
    onMutate: async (action) => {
      await client.cancelQueries({ queryKey: settlementKeys.balances(groupId) });
      await client.cancelQueries({ queryKey: settlementKeys.list(groupId) });
      const previousBalances = client.getQueryData<Balances>(settlementKeys.balances(groupId));
      const previousList = client.getQueryData<InfiniteData<SettlementPage>>(
        settlementKeys.list(groupId),
      );
      const target = previousList?.pages
        .flatMap((page) => page.settlements)
        .find((s) => s.id === action.settlementId);
      if (target?.status === "confirmed") {
        if (previousBalances) {
          client.setQueryData<Balances>(settlementKeys.balances(groupId), {
            ...previousBalances,
            balances: previousBalances.balances.map((b) => {
              if (b.memberId === target.payerMemberId) {
                return { ...b, balance: b.balance - target.amount };
              }
              if (b.memberId === target.receiverMemberId) {
                return { ...b, balance: b.balance + target.amount };
              }
              return b;
            }),
          });
        }
        replaceSettlement(client, groupId, { ...target, status: "undone" });
      }
      return { previousBalances, previousList };
    },
    onError: (_err, _action, context) => {
      if (context?.previousBalances) {
        client.setQueryData(settlementKeys.balances(groupId), context.previousBalances);
      }
      if (context?.previousList) {
        client.setQueryData(settlementKeys.list(groupId), context.previousList);
      }
      void refresh();
    },
    onSuccess: (undone) => {
      replaceSettlement(client, groupId, undone);
      void refresh();
    },
  });
}
