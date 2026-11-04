import type { Balances, Settlement, SettlementInput, SettlementPage } from "@split/shared";
import {
  type InfiniteData,
  type QueryClient,
  type QueryFunctionContext,
  type QueryKey,
  hashKey,
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
 * Moves the payer's Balance up and the receiver's down by `amount` (negative: the reverse) on
 * whatever the cache holds now. A rollback does the reverse of one write instead of restoring an
 * older snapshot, so a payment that finished in the meantime is kept.
 */
function shiftBalances(
  client: QueryClient,
  groupId: string,
  payerMemberId: string,
  receiverMemberId: string,
  amount: number,
) {
  client.setQueryData<Balances>(settlementKeys.balances(groupId), (data) =>
    data === undefined
      ? data
      : {
          ...data,
          balances: data.balances.map((b) => {
            if (b.memberId === payerMemberId) return { ...b, balance: b.balance + amount };
            if (b.memberId === receiverMemberId) return { ...b, balance: b.balance - amount };
            return b;
          }),
        },
  );
}

/**
 * Tells whether a read from the server has replaced the cached value under `key` since now. Such
 * a value already holds the server's answer, so a rollback must leave it alone. Call `stop` once
 * the write has settled.
 */
function watchReads(client: QueryClient, key: QueryKey) {
  const hash = hashKey(key);
  let replaced = false;
  const stop = client.getQueryCache().subscribe((event) => {
    if (
      event.type === "updated" &&
      event.action.type === "success" &&
      !event.action.manual &&
      event.query.queryHash === hash
    ) {
      replaced = true;
    }
  });
  return { replaced: () => replaced, stop };
}

/**
 * Records a Settlement under the caller's `Idempotency-Key`. The ledger records it as confirmed.
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
      const shown = client.getQueryData<Balances>(settlementKeys.balances(groupId)) !== undefined;
      const reads = watchReads(client, settlementKeys.balances(groupId));
      shiftBalances(client, groupId, input.payerMemberId, input.receiverMemberId, input.amount);
      return { shown, reads };
    },
    onError: (_err, { input }, context) => {
      if (context?.shown && !context.reads.replaced()) {
        shiftBalances(client, groupId, input.payerMemberId, input.receiverMemberId, -input.amount);
      }
    },
    onSettled: (_data, _err, _vars, context) => {
      context?.reads.stop();
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
      const list = client.getQueryData<InfiniteData<SettlementPage>>(settlementKeys.list(groupId));
      const target = list?.pages
        .flatMap((page) => page.settlements)
        .find((s) => s.id === action.settlementId);
      if (target?.status !== "confirmed") return { target: undefined };
      const balanceReads = watchReads(client, settlementKeys.balances(groupId));
      const listReads = watchReads(client, settlementKeys.list(groupId));
      shiftBalances(client, groupId, target.payerMemberId, target.receiverMemberId, -target.amount);
      replaceSettlement(client, groupId, { ...target, status: "undone" });
      return { target, balanceReads, listReads };
    },
    // Only this undo is taken back: a payment confirmed while it waited stays in the Balances, and
    // whatever a read from the server has replaced since is left as the server said.
    onError: (_err, _action, context) => {
      if (context?.target !== undefined) {
        const { target, balanceReads, listReads } = context;
        if (!balanceReads.replaced()) {
          shiftBalances(
            client,
            groupId,
            target.payerMemberId,
            target.receiverMemberId,
            target.amount,
          );
        }
        if (!listReads.replaced()) replaceSettlement(client, groupId, target);
      }
      void refresh();
    },
    onSettled: (_data, _err, _vars, context) => {
      context?.balanceReads?.stop();
      context?.listReads?.stop();
    },
    onSuccess: (undone) => {
      replaceSettlement(client, groupId, undone);
      void refresh();
    },
  });
}
