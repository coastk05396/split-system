import type { QueryClient, QueryFunctionContext, QueryKey } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { toApiFailure } from "../api/errors.js";
import { useAuth } from "../auth/AuthProvider.js";
import { useDeps } from "../app/AppProviders.js";
import { setQueryRestored } from "./cache-persistence.js";

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

  const toFetch: Promise<unknown>[] = [];
  for (const query of activeQueries) {
    const recordedRev = getQueryRev(client, query.queryKey);
    if (recordedRev === undefined || recordedRev < rev) {
      // cancelRefetch: a request already in flight began before this signal and may hold older data.
      toFetch.push(query.fetch(undefined, { cancelRefetch: true }));
    }
  }
  await Promise.all(toFetch);
}

/**
 * After a mutation returns rev N:
 * Sets the updated query's rev to N (if provided) and invalidates the other Group queries
 * rather than marking them as N (ADR 0004 & SPEC §5).
 */
export function onGroupMutationSuccess(
  client: QueryClient,
  groupId: string,
  rev: number,
  options?: { updatedQueryKey?: QueryKey },
): void {
  if (options?.updatedQueryKey) {
    setQueryRev(client, options.updatedQueryKey, rev);
  }

  void client.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey;
      const isGroupQuery = key[0] === "groups" && key[1] === groupId;
      if (!isGroupQuery) return false;
      if (options?.updatedQueryKey && hashKey(key) === hashKey(options.updatedQueryKey)) {
        return false;
      }
      return true;
    },
  });
}

/**
 * Computes the backoff wait in milliseconds for attempt N:
 * 1s, 2s, 4s, 8s, up to 30s with random jitter within ±20%, capped at 30 seconds.
 */
export function computeBackoffWait(attempt: number, random = Math.random): number {
  const baseSteps = [1000, 2000, 4000, 8000, 16000, 30000];
  const base = baseSteps[attempt] ?? 30000;
  const jitter = 0.8 + 0.4 * random(); // ±20%
  const wait = Math.round(base * jitter);
  return Math.min(wait, 30000);
}

export function getLiveWsUrl(groupId: string, baseUrl?: string): string {
  if (baseUrl) {
    const protocol = baseUrl.startsWith("https") ? "wss:" : "ws:";
    const host = baseUrl.replace(/^https?:\/\//, "");
    return `${protocol}//${host}/api/v1/groups/${encodeURIComponent(groupId)}/live`;
  }
  const protocol =
    typeof window !== "undefined" && window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = typeof window !== "undefined" ? window.location.host : "localhost";
  return `${protocol}//${host}/api/v1/groups/${encodeURIComponent(groupId)}/live`;
}

export interface GroupLiveSyncOptions {
  groupId: string;
  queryClient: QueryClient;
  getAccessToken: () => string | null | Promise<string | null>;
  WebSocket?: typeof WebSocket | undefined;
  baseUrl?: string;
  pingIntervalMs?: number;
  random?: () => number;
}

export class GroupLiveSync {
  private socket: WebSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private awaitingPong = false;
  private missedPongs = 0;
  private isDisposed = false;

  constructor(private readonly options: GroupLiveSyncOptions) {}

  public connect(): void {
    if (this.isDisposed) return;
    if (this.socket && (this.socket.readyState === 0 || this.socket.readyState === 1)) {
      return;
    }

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibilityChange);
    }

    void this.startConnection();
  }

  private async startConnection(): Promise<void> {
    if (this.isDisposed) return;
    const token = await this.options.getAccessToken();
    if (!token) {
      this.scheduleReconnect();
      return;
    }

    const WS =
      this.options.WebSocket ?? (typeof WebSocket !== "undefined" ? WebSocket : undefined);
    if (!WS) return;

    const url = getLiveWsUrl(this.options.groupId, this.options.baseUrl);
    try {
      this.socket = new WS(url, ["split.v1", token]);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.socket.addEventListener("open", this.onOpen);
    this.socket.addEventListener("message", this.onMessage);
    this.socket.addEventListener("close", this.onClose);
    this.socket.addEventListener("error", this.onError);
  }

  private onOpen = (): void => {
    this.attempt = 0;
    this.awaitingPong = false;
    this.missedPongs = 0;

    // Catch up once on every open, the first too: changes made between the initial read and the
    // socket being accepted raised no signal this client could hear. Cancelling an in-flight read
    // matters because it may have been answered before the socket was listening.
    void this.options.queryClient.refetchQueries(
      {
        predicate: (query) => {
          const key = query.queryKey;
          return key[0] === "groups" && key[1] === this.options.groupId && query.isActive();
        },
      },
      { cancelRefetch: true },
    );

    this.startPing();
  };

  private startPing(): void {
    this.stopPing();
    const interval = this.options.pingIntervalMs ?? 20_000;
    this.pingTimer = setInterval(() => {
      if (this.awaitingPong) {
        this.missedPongs++;
        if (this.missedPongs >= 2) {
          // "treats two missed pong replies as a dead connection"
          this.closeAndReconnect();
          return;
        }
      }
      this.awaitingPong = true;
      try {
        this.socket?.send("ping");
      } catch {
        this.closeAndReconnect();
      }
    }, interval);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private onMessage = (event: MessageEvent): void => {
    const data: unknown = event.data;
    if (typeof data === "string") {
      if (data === "pong") {
        this.awaitingPong = false;
        this.missedPongs = 0;
        return;
      }
      try {
        const payload = JSON.parse(data) as Record<string, unknown>;
        if (payload.type === "sync needed" && typeof payload.rev === "number") {
          void handleGroupSignal(this.options.queryClient, this.options.groupId, payload.rev);
        }
      } catch {
        // Unknown message types and fields are ignored.
      }
    }
  };

  private onClose = (): void => {
    this.stopPing();
    this.cleanupSocket();
    this.scheduleReconnect();
  };

  private onError = (): void => {
    this.stopPing();
    this.cleanupSocket();
    this.scheduleReconnect();
  };

  private closeAndReconnect(): void {
    this.stopPing();
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // Ignore
      }
      this.cleanupSocket();
    }
    this.scheduleReconnect();
  }

  private cleanupSocket(): void {
    if (!this.socket) return;
    this.socket.removeEventListener("open", this.onOpen);
    this.socket.removeEventListener("message", this.onMessage);
    this.socket.removeEventListener("close", this.onClose);
    this.socket.removeEventListener("error", this.onError);
    this.socket = null;
  }

  private scheduleReconnect(): void {
    if (this.isDisposed || this.reconnectTimer !== null) return;
    const wait = computeBackoffWait(this.attempt, this.options.random);
    this.attempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.startConnection();
    }, wait);
  }

  private onVisibilityChange = (): void => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      // Reconnects at once when the page returns to the foreground
      if (!this.socket || this.socket.readyState !== 1) {
        if (this.reconnectTimer !== null) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        void this.startConnection();
      }
    }
  };

  public disconnect(): void {
    this.isDisposed = true;
    this.stopPing();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // Ignore
      }
      this.cleanupSocket();
    }
  }
}

// Registry to ensure one WebSocket connection per Group
const activeGroupSyncs = new Map<string, { sync: GroupLiveSync; count: number }>();

export function useGroupLiveSync(groupId: string | undefined): void {
  const client = useQueryClient();
  const { session } = useAuth();
  const deps = useDeps();
  const activeRef = useRef<GroupLiveSync | null>(null);

  useEffect(() => {
    if (!groupId) return;

    let entry = activeGroupSyncs.get(groupId);
    if (!entry) {
      const sync = new GroupLiveSync({
        groupId,
        queryClient: client,
        getAccessToken: () => session.getAccessToken(),
        WebSocket: deps.webSocket,
      });
      entry = { sync, count: 0 };
      activeGroupSyncs.set(groupId, entry);
      sync.connect();
    }
    entry.count++;
    activeRef.current = entry.sync;

    return () => {
      const current = activeGroupSyncs.get(groupId);
      if (current) {
        current.count--;
        if (current.count <= 0) {
          current.sync.disconnect();
          activeGroupSyncs.delete(groupId);
        }
      }
    };
  }, [groupId, client, session, deps]);
}
