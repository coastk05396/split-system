import type { Balances, Settlement, SettlementInput, SettlementPage } from "@split/shared";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { ClientRequestOptions } from "hono/client";
import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/AuthProvider.js";
import { groupKeys } from "../groups/api.js";
import { readWithRev } from "../groups/sync.js";

/** TanStack Query hooks over the Worker's Balance and Settlement routes (SPEC §5.1). */

export const settlementKeys = {
  balances: (groupId: string) => ["groups", groupId, "balances"] as const,
  list: (groupId: string) => ["groups", groupId, "settlements"] as const,
};

function useSession() {
  const { session } = useAuth();
  return useMemo(() => ({ api: createApiClient(session.fetch), fetch: session.fetch }), [session]);
}

async function read<T>(call: Promise<Response>, context?: { client: unknown; queryKey: unknown }): Promise<T> {
  return readWithRev<T>(call, context as never);
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
    queryFn: (ctx) => read<Balances>(api.groups[":id"].balances.$get({ param: { id: groupId } }), ctx),
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
      return read<SettlementPage>(fetch(url), ctx);
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

/** Re-reads the Group (Balances, Members, Settlements) and the Group list after a write. */
function useRefresh(groupId: string) {
  const client = useQueryClient();
  return () =>
    Promise.all([
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
  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: SettlementInput; idempotencyKey: string }) =>
      read<Settlement>(
        api.groups[":id"].settlements.$post(
          { param: { id: groupId } },
          jsonWith(input, { "Idempotency-Key": idempotencyKey }),
        ),
      ),
    onSuccess: refresh,
  });
}

export type SettlementAction =
  | { kind: "confirm"; settlementId: string; amount?: number }
  | { kind: "cancel"; settlementId: string }
  | { kind: "undo"; settlementId: string };

/** Confirm (optionally at a lower amount), cancel or undo one Settlement. */
export function useSettlementAction(groupId: string) {
  const { api } = useSession();
  const refresh = useRefresh(groupId);
  return useMutation({
    mutationFn: (action: SettlementAction) => {
      const param = { param: { sid: action.settlementId } };
      const routes = api.settlements[":sid"];
      switch (action.kind) {
        case "confirm":
          return read<Settlement>(
            routes.confirm.$post(
              param,
              action.amount === undefined ? undefined : jsonWith({ amount: action.amount }),
            ),
          );
        case "cancel":
          return read<Settlement>(routes.cancel.$post(param));
        case "undo":
          return read<Settlement>(routes.undo.$post(param));
      }
    },
    onSuccess: refresh,
  });
}
