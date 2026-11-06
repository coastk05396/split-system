import type { CurrencyCode } from "@split/shared";
import type { QueryClient, QueryFunctionContext, QueryKey } from "@tanstack/react-query";
import { useMemo } from "react";
import { createApiClient } from "../api/client.js";
import { toApiFailure } from "../api/errors.js";
import { useAuth } from "../auth/AuthProvider.js";
import { setQueryRestored } from "./cache-persistence.js";

export const groupKeys = {
  all: ["groups"] as const,
  group: (id: string) => ["groups", id] as const,
  members: (id: string) => ["groups", id, "members"] as const,
  invite: (id: string) => ["groups", id, "invite"] as const,
  preview: (token: string) => ["invites", token] as const,
};

export const expenseKeys = {
  list: (groupId: string) => ["groups", groupId, "expenses"] as const,
  one: (groupId: string, expenseId: string) => ["groups", groupId, "expenses", expenseId] as const,
  stops: (groupId: string, day: string) => ["groups", groupId, "stops", day] as const,
  rate: (date: string, base: CurrencyCode, quote: CurrencyCode) =>
    ["rates", date, base, quote] as const,
};

export const settlementKeys = {
  balances: (groupId: string) => ["groups", groupId, "balances"] as const,
  list: (groupId: string) => ["groups", groupId, "settlements"] as const,
};

export const tripKeys = {
  stops: (id: string) => ["groups", id, "stops"] as const,
  /** Under the Group's key, so an Expense change that refreshes the Group refreshes these. */
  stopExpenses: (id: string) => ["groups", id, "stopExpenses"] as const,
};

/** Shared session transport for Group reads and writes, including routes called by path. */
export function useGroupData() {
  const { session } = useAuth();
  return useMemo(() => ({ api: createApiClient(session.fetch), fetch: session.fetch }), [session]);
}

export async function send(call: Promise<Response>): Promise<void> {
  const res: Response = await call;
  if (!res.ok) throw await toApiFailure(res);
}

const clientRevs = new WeakMap<QueryClient, Map<string, number>>();

function getRevMap(client: QueryClient): Map<string, number> {
  let map = clientRevs.get(client);
  if (!map) {
    map = new Map<string, number>();
    clientRevs.set(client, map);
  }
  return map;
}

function hashKey(key: QueryKey): string {
  return JSON.stringify(key);
}

/** Returns the recorded X-Group-Rev for a cached query, if any. */
export function getQueryRev(client: QueryClient, queryKey: QueryKey): number | undefined {
  const hash = hashKey(queryKey);
  const fromMap = getRevMap(client).get(hash);
  if (fromMap !== undefined) return fromMap;
  const query = client.getQueryCache().find({ queryKey });
  if (query && typeof (query.meta as { rev?: number } | undefined)?.rev === "number") {
    return (query.meta as { rev?: number }).rev;
  }
  return undefined;
}

/** Records the X-Group-Rev for a cached query. */
export function setQueryRev(client: QueryClient, queryKey: QueryKey, rev: number): void {
  const hash = hashKey(queryKey);
  getRevMap(client).set(hash, rev);
  const query = client.getQueryCache().find({ queryKey });
  if (query) {
    const opts = query.options as { meta?: Record<string, unknown> };
    opts.meta ??= {};
    opts.meta.rev = rev;
  }
}

/**
 * The request init that ties an in-flight read to its query: Query aborts the signal when the
 * query is cancelled, so a read superseded by a catch-up stops on the network instead of
 * finishing and being thrown away.
 */
export function abortable(context: { signal?: AbortSignal } | undefined): { signal?: AbortSignal } {
  return context?.signal === undefined ? {} : { signal: context.signal };
}

/**
 * Reads a JSON response and checks X-Group-Rev against the query's recorded rev.
 * Discards an older response if the query already holds newer data (ADR 0004 & SPEC §5).
 */
export async function readWithRev<T>(
  call: Promise<Response>,
  context?: QueryFunctionContext | { client: QueryClient; queryKey: QueryKey },
): Promise<T> {
  const res: Response = await call;
  if (!res.ok) throw await toApiFailure(res);

  const revHeader = res.headers.get("X-Group-Rev");
  if (context) {
    const client = context.client;
    const queryKey = context.queryKey;
    setQueryRestored(client, queryKey, false);

    if (revHeader !== null) {
      const rev = Number(revHeader);
      if (!Number.isNaN(rev)) {
        const currentRev = getQueryRev(client, queryKey);
        if (currentRev !== undefined && rev < currentRev) {
          const existing = client.getQueryData<T>(queryKey);
          if (existing !== undefined) {
            return existing;
          }
        }
        setQueryRev(client, queryKey, rev);
      }
    }
  }

  return (await res.json()) as T;
}

const statsRefreshTimers = new WeakMap<QueryClient, ReturnType<typeof setTimeout>>();

export function cancelStatsInvalidation(client: QueryClient): void {
  clearTimeout(statsRefreshTimers.get(client));
  statsRefreshTimers.delete(client);
}

/**
 * Stats read a delayed D1 projection, so recheck after its usual catch-up window.
 * shortcut: delays over 3s need another refresh; use completion signals if frequent.
 */
export function invalidateStats(client: QueryClient): Promise<void> {
  cancelStatsInvalidation(client);
  statsRefreshTimers.set(
    client,
    setTimeout(() => {
      statsRefreshTimers.delete(client);
      void client.invalidateQueries({ queryKey: ["stats"] });
    }, 3000),
  );
  return client.invalidateQueries({ queryKey: ["stats"] });
}

/**
 * Handles a "sync needed" signal with rev N:
 * Refetches every active Group query whose recorded rev is below N, leaving the rest alone.
 */
export async function handleGroupSignal(
  client: QueryClient,
  groupId: string,
  rev: number,
): Promise<void> {
  const activeQueries = client.getQueryCache().findAll({
    predicate: (query) => {
      const key = query.queryKey;
      return key[0] === "groups" && key[1] === groupId && query.isActive();
    },
  });

  const toFetch: Promise<unknown>[] = [invalidateStats(client)];
  for (const query of activeQueries) {
    const recordedRev = getQueryRev(client, query.queryKey);
    if (recordedRev === undefined || recordedRev < rev) {
      // cancelRefetch: a request already in flight began before this signal and may hold older data.
      toFetch.push(query.fetch(undefined, { cancelRefetch: true }));
    }
  }
  await Promise.all(toFetch);
}

/** Re-reads a Group, the Home Group list and the delayed Personal spending projection. */
export async function refreshGroup(client: QueryClient, groupId: string): Promise<void> {
  await Promise.all([
    invalidateStats(client),
    client.invalidateQueries({ queryKey: groupKeys.group(groupId) }),
    client.invalidateQueries({ queryKey: groupKeys.all, exact: true }),
  ]);
}
