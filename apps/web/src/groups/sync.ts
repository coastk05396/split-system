import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useAuth } from "../auth/AuthProvider.js";
import { useDeps } from "../app/AppProviders.js";
import { handleGroupSignal } from "./data.js";

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
  private hasOpened = false;

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

  private disposed(): boolean {
    return this.isDisposed;
  }

  private async startConnection(): Promise<void> {
    if (this.isDisposed) return;
    const token = await this.options.getAccessToken();
    // Read through a method: the check above would make the compiler assume it still holds.
    if (this.disposed()) return;
    if (!token) {
      this.scheduleReconnect();
      return;
    }

    const WS = this.options.WebSocket ?? (typeof WebSocket !== "undefined" ? WebSocket : undefined);
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
    const firstOpen = !this.hasOpened;
    this.hasOpened = true;
    if (firstOpen) this.abortInitialReads();
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

  /**
   * On the first connect, a Group query that is still loading its first answer holds nothing worth
   * keeping: abort its request so the catch-up read replaces it, rather than racing a response
   * that may predate the socket. A query with cached data is left to the refetch, which cancels
   * and reverts to that data.
   */
  private abortInitialReads(): void {
    const { queryClient, groupId } = this.options;
    for (const query of queryClient.getQueryCache().findAll({
      predicate: (candidate) => {
        const key = candidate.queryKey;
        return key[0] === "groups" && key[1] === groupId && candidate.isActive();
      },
    })) {
      if (query.state.data === undefined && query.state.fetchStatus === "fetching")
        void query.cancel({ silent: true });
    }
  }

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
        getAccessToken: async () => {
          const user = await session.restore().catch(() => null);
          return user === null ? null : session.getAccessToken();
        },
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
