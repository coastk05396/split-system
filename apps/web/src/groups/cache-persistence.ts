import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { getQueryRev, setQueryRev } from "./sync.js";

export const CACHE_VERSION = "split.v1";

export interface CacheStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getDefaultStorage(): CacheStorage {
  try {
    if (typeof window !== "undefined") {
      return window.localStorage;
    }
  } catch {
    // In restricted iframe or disabled storage environments
  }
  return {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
}

export function getCacheKey(userId: string, version = CACHE_VERSION): string {
  return `split.queryCache.${userId}.${version}`;
}

const restoredQueries = new WeakMap<QueryClient, Set<string>>();
const listeners = new WeakMap<QueryClient, Set<() => void>>();

function getRestoredSet(client: QueryClient): Set<string> {
  let set = restoredQueries.get(client);
  if (!set) {
    set = new Set<string>();
    restoredQueries.set(client, set);
  }
  return set;
}

function getListenerSet(client: QueryClient): Set<() => void> {
  let set = listeners.get(client);
  if (!set) {
    set = new Set<() => void>();
    listeners.set(client, set);
  }
  return set;
}

function notify(client: QueryClient) {
  for (const listener of getListenerSet(client)) {
    listener();
  }
}

export function setQueryRestored(client: QueryClient, queryKey: QueryKey, restored: boolean): void {
  const hash = JSON.stringify(queryKey);
  const set = getRestoredSet(client);
  if (restored) {
    set.add(hash);
  } else {
    set.delete(hash);
  }
  notify(client);
}

export function isQueryRestored(client: QueryClient, queryKey: QueryKey): boolean {
  const hash = JSON.stringify(queryKey);
  return getRestoredSet(client).has(hash);
}

/** React hook that returns true while a query holds restored data that has not yet been confirmed. */
export function useIsUpdating(queryKey: QueryKey): boolean {
  const client = useQueryClient();
  return useSyncExternalStore(
    (onStoreChange) => {
      const set = getListenerSet(client);
      set.add(onStoreChange);
      return () => {
        set.delete(onStoreChange);
      };
    },
    () => isQueryRestored(client, queryKey),
  );
}

function hasOptimisticItem(data: unknown): boolean {
  if (data === null || typeof data !== "object") return false;
  if (Array.isArray(data)) {
    return data.some(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as { id?: unknown }).id === "string" &&
        (item as { id: string }).id.startsWith("tmp-"),
    );
  }
  if ("pages" in data && Array.isArray((data as { pages: unknown[] }).pages)) {
    return (data as { pages: unknown[] }).pages.some((page) => hasOptimisticItem(page));
  }
  for (const value of Object.values(data as Record<string, unknown>)) {
    if (Array.isArray(value) && hasOptimisticItem(value)) {
      return true;
    }
  }
  return false;
}

export function saveCache(
  client: QueryClient,
  userId: string,
  storage: CacheStorage = getDefaultStorage(),
  version = CACHE_VERSION,
): void {
  const queries = client
    .getQueryCache()
    .getAll()
    .filter((q) => {
      if (q.state.data === undefined) return false;
      if (hasOptimisticItem(q.state.data)) {
        return false;
      }
      return true;
    })
    .map((q) => ({
      queryKey: q.queryKey,
      data: q.state.data,
      rev: getQueryRev(client, q.queryKey),
    }));

  const payload = {
    version,
    userId,
    queries,
    savedAt: Date.now(),
  };
  try {
    storage.setItem(getCacheKey(userId, version), JSON.stringify(payload));
  } catch {
    /* ignore storage quota exceeded or disabled */
  }
}

export function restoreCache(
  client: QueryClient,
  userId: string,
  storage: CacheStorage = getDefaultStorage(),
  version = CACHE_VERSION,
): boolean {
  const raw = storage.getItem(getCacheKey(userId, version));
  if (!raw) return false;
  try {
    const payload = JSON.parse(raw) as {
      version: string;
      userId: string;
      queries: Array<{ queryKey: QueryKey; data: unknown; rev?: number }>;
    };
    if (payload.version !== version || payload.userId !== userId) {
      storage.removeItem(getCacheKey(userId, version));
      return false;
    }
    for (const item of payload.queries) {
      client.setQueryData(item.queryKey, item.data, { updatedAt: 0 });
      if (typeof item.rev === "number") {
        setQueryRev(client, item.queryKey, item.rev);
      }
      setQueryRestored(client, item.queryKey, true);
    }
    return true;
  } catch {
    storage.removeItem(getCacheKey(userId, version));
    return false;
  }
}

export function clearCache(
  userId: string,
  storage: CacheStorage = getDefaultStorage(),
  version = CACHE_VERSION,
): void {
  storage.removeItem(getCacheKey(userId, version));
}
