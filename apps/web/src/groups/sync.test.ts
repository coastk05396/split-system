import { QueryClient, type QueryKey, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeBackoffWait,
  getQueryRev,
  GroupLiveSync,
  handleGroupSignal,
  onGroupMutationSuccess,
  readWithRev,
  setQueryRev,
} from "./sync.js";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static clear() {
    FakeWebSocket.instances = [];
  }

  url: string;
  protocol = "";
  protocols: string | string[] | undefined;
  readyState = 0; // 0 = CONNECTING, 1 = OPEN, 2 = CLOSING, 3 = CLOSED
  sent: string[] = [];
  listeners: Record<string, Array<(event: unknown) => void>> = {};

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = protocols;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void) {
    let list = this.listeners[type];
    if (!list) {
      list = [];
      this.listeners[type] = list;
    }
    list.push(listener);
  }

  removeEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((l) => l !== listener);
  }

  dispatchEvent(event: { type: string; [k: string]: unknown }) {
    for (const l of [...(this.listeners[event.type] ?? [])]) {
      l(event);
    }
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this.readyState = 3;
    this.dispatchEvent({ type: "close", code: code ?? 1000, reason });
  }

  open() {
    this.readyState = 1;
    this.dispatchEvent({ type: "open" });
  }

  receive(data: unknown) {
    this.dispatchEvent({
      type: "message",
      data: typeof data === "string" ? data : JSON.stringify(data),
    });
  }
}

function getSocket(index = 0): FakeWebSocket {
  const socket = FakeWebSocket.instances[index];
  expect(socket).toBeDefined();
  if (!socket) throw new Error(`No socket at index ${index}`);
  return socket;
}

function getQuery(client: QueryClient, queryKey: QueryKey) {
  const q = client.getQueryCache().find({ queryKey });
  expect(q).toBeDefined();
  if (!q) throw new Error(`Query not found for key ${JSON.stringify(queryKey)}`);
  return q;
}

describe("Web live sync: connection, heartbeat, reconnect and rev rule", () => {
  let client: QueryClient;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.clear();
    client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("Connection and handshake", () => {
    it("opens the Group WebSocket with split.v1 and access token as subprotocols", async () => {
      const sync = new GroupLiveSync({
        groupId: "g-1",
        queryClient: client,
        getAccessToken: () => "token-123",
        WebSocket: FakeWebSocket as unknown as typeof WebSocket,
        baseUrl: "http://localhost:5173",
      });
      sync.connect();
      await Promise.resolve();

      expect(FakeWebSocket.instances.length).toBe(1);
      const socket = getSocket(0);
      expect(socket.url).toBe("ws://localhost:5173/api/v1/groups/g-1/live");
      expect(socket.protocols).toEqual(["split.v1", "token-123"]);
      sync.disconnect();
    });
  });

  describe("Heartbeat and dead connection detection", () => {
    it("sends ping every 20 seconds and resets on pong", async () => {
      const sync = new GroupLiveSync({
        groupId: "g-1",
        queryClient: client,
        getAccessToken: () => "token-123",
        WebSocket: FakeWebSocket as unknown as typeof WebSocket,
        baseUrl: "http://localhost:5173",
      });
      sync.connect();
      await Promise.resolve();
      const socket = getSocket(0);
      socket.open();

      // At 20s: first ping
      vi.advanceTimersByTime(20_000);
      expect(socket.sent).toEqual(["ping"]);

      // Server answers pong
      socket.receive("pong");

      // At 40s: second ping
      vi.advanceTimersByTime(20_000);
      expect(socket.sent).toEqual(["ping", "ping"]);

      sync.disconnect();
    });

    it("treats two missed pongs as a dead connection and triggers reconnect", async () => {
      const sync = new GroupLiveSync({
        groupId: "g-1",
        queryClient: client,
        getAccessToken: () => "token-123",
        WebSocket: FakeWebSocket as unknown as typeof WebSocket,
        baseUrl: "http://localhost:5173",
      });
      sync.connect();
      await Promise.resolve();
      const socket1 = getSocket(0);
      socket1.open();

      // At 20s: ping 1 sent, pong not answered
      vi.advanceTimersByTime(20_000);
      expect(socket1.sent).toEqual(["ping"]);

      // At 40s: ping 2 sent, first pong was missed
      vi.advanceTimersByTime(20_000);
      expect(socket1.sent).toEqual(["ping", "ping"]);

      // At 60s: second pong missed -> dead connection!
      vi.advanceTimersByTime(20_000);
      expect(socket1.readyState).toBe(3); // closed

      // Reconnect scheduled with backoff attempt 0 (1s base)
      expect(FakeWebSocket.instances.length).toBe(1);
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();

      expect(FakeWebSocket.instances.length).toBe(2);
      sync.disconnect();
    });
  });

  describe("Reconnect backoff sequence, jitter and foreground return", () => {
    it("follows backoff sequence 1, 2, 4, 8, up to 30s with jitter within ±20% and caps at 30s", () => {
      // Test deterministic jitter bounds: min (random = 0) and max (random = 1)
      const attempts = [0, 1, 2, 3, 4, 5, 6];
      const baseSteps = [1000, 2000, 4000, 8000, 16000, 30000, 30000];

      for (let i = 0; i < attempts.length; i++) {
        const attempt = attempts[i] ?? 0;
        const base = baseSteps[i] ?? 30000;

        const minWait = computeBackoffWait(attempt, () => 0);
        const maxWait = computeBackoffWait(attempt, () => 1);
        const midWait = computeBackoffWait(attempt, () => 0.5);

        // Min wait is base * 0.8 (capped at 30000)
        expect(minWait).toBe(Math.min(Math.round(base * 0.8), 30000));
        // Max wait is base * 1.2 (capped at 30000)
        expect(maxWait).toBe(Math.min(Math.round(base * 1.2), 30000));
        // Mid wait is base * 1.0 (capped at 30000)
        expect(midWait).toBe(Math.min(base, 30000));
        // Never exceeds 30 seconds
        expect(maxWait).toBeLessThanOrEqual(30000);
      }
    });

    it("reconnects at once when the page returns to the foreground", async () => {
      const sync = new GroupLiveSync({
        groupId: "g-1",
        queryClient: client,
        getAccessToken: () => "token-123",
        WebSocket: FakeWebSocket as unknown as typeof WebSocket,
        baseUrl: "http://localhost:5173",
      });
      sync.connect();
      await Promise.resolve();
      const socket1 = getSocket(0);
      socket1.open();

      // Socket drops
      socket1.close(1006);
      expect(FakeWebSocket.instances.length).toBe(1);

      // Visibility returns to foreground immediately
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();

      // Connected at once without waiting for backoff timer
      expect(FakeWebSocket.instances.length).toBe(2);
      sync.disconnect();
    });

    it("refetches the Group once after every successful open, the first included", async () => {
      const sync = new GroupLiveSync({
        groupId: "g-1",
        queryClient: client,
        getAccessToken: () => "token-123",
        WebSocket: FakeWebSocket as unknown as typeof WebSocket,
        baseUrl: "http://localhost:5173",
      });
      const refetchSpy = vi.spyOn(client, "refetchQueries");

      sync.connect();
      await Promise.resolve();
      const socket1 = getSocket(0);
      socket1.open();

      // First open catches up on changes made before the socket was listening
      expect(refetchSpy).toHaveBeenCalledTimes(1);
      expect(refetchSpy).toHaveBeenLastCalledWith(expect.anything(), { cancelRefetch: true });

      // Drops and reconnects
      socket1.close(1006);
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
      const socket2 = getSocket(1);
      socket2.open();

      // Successful reconnect triggers Group refetch
      expect(refetchSpy).toHaveBeenCalledTimes(2);
      sync.disconnect();
    });
  });

  describe("Unknown messages and fields", () => {
    it("ignores unknown message types and unknown fields", async () => {
      const sync = new GroupLiveSync({
        groupId: "g-1",
        queryClient: client,
        getAccessToken: () => "token-123",
        WebSocket: FakeWebSocket as unknown as typeof WebSocket,
        baseUrl: "http://localhost:5173",
      });

      sync.connect();
      await Promise.resolve();
      const socket = getSocket(0);
      socket.open();

      // Non-JSON message
      socket.receive("random text");
      // Unknown type
      socket.receive({ type: "some_new_feature", rev: 100 });
      // Valid type with extra unknown fields
      socket.receive({
        version: 1,
        type: "sync needed",
        rev: 42,
        extraField: "ignored",
      });

      // No unexpected errors occurred
      sync.disconnect();
    });
  });

  describe("Rev rule and query synchronization", () => {
    it("a signal refetches only the Group queries whose recorded rev is lower", async () => {
      const obsMembers = new QueryObserver(client, { queryKey: ["groups", "g-1", "members"] });
      const obsExpenses = new QueryObserver(client, { queryKey: ["groups", "g-1", "expenses"] });
      obsMembers.subscribe(() => {});
      obsExpenses.subscribe(() => {});

      const qMembers = getQuery(client, ["groups", "g-1", "members"]);
      const qExpenses = getQuery(client, ["groups", "g-1", "expenses"]);

      // Record revs
      setQueryRev(client, ["groups", "g-1", "members"], 42);
      setQueryRev(client, ["groups", "g-1", "expenses"], 40);

      const fetchMembersSpy = vi.spyOn(qMembers, "fetch").mockResolvedValue(undefined);
      const fetchExpensesSpy = vi.spyOn(qExpenses, "fetch").mockResolvedValue(undefined);

      // Signal at rev 42 arrives
      await handleGroupSignal(client, "g-1", 42);

      // expenses (rev 40 < 42) is refetched
      expect(fetchExpensesSpy).toHaveBeenCalledTimes(1);
      // members (rev 42 not < 42) is left alone
      expect(fetchMembersSpy).not.toHaveBeenCalled();
    });

    it("a signal not newer than a query's recorded rev leaves it alone", async () => {
      const obs = new QueryObserver(client, { queryKey: ["groups", "g-1", "balances"] });
      obs.subscribe(() => {});
      const q = getQuery(client, ["groups", "g-1", "balances"]);
      setQueryRev(client, ["groups", "g-1", "balances"], 45);

      const fetchSpy = vi.spyOn(q, "fetch").mockResolvedValue(undefined);

      // Older signal at rev 44
      await handleGroupSignal(client, "g-1", 44);
      expect(fetchSpy).not.toHaveBeenCalled();

      // Equal signal at rev 45
      await handleGroupSignal(client, "g-1", 45);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("a members response at rev 42 does not stop a signal at 42 from refetching expenses and balances queries", async () => {
      const obsMembers = new QueryObserver(client, { queryKey: ["groups", "g-1", "members"] });
      const obsExpenses = new QueryObserver(client, { queryKey: ["groups", "g-1", "expenses"] });
      const obsBalances = new QueryObserver(client, { queryKey: ["groups", "g-1", "balances"] });
      obsMembers.subscribe(() => {});
      obsExpenses.subscribe(() => {});
      obsBalances.subscribe(() => {});

      const qMembers = getQuery(client, ["groups", "g-1", "members"]);
      const qExpenses = getQuery(client, ["groups", "g-1", "expenses"]);
      const qBalances = getQuery(client, ["groups", "g-1", "balances"]);

      // Members response arrived with rev 42
      setQueryRev(client, ["groups", "g-1", "members"], 42);
      // Expenses and balances queries hold older responses
      setQueryRev(client, ["groups", "g-1", "expenses"], 39);
      setQueryRev(client, ["groups", "g-1", "balances"], 39);

      const fetchMembersSpy = vi.spyOn(qMembers, "fetch").mockResolvedValue(undefined);
      const fetchExpensesSpy = vi.spyOn(qExpenses, "fetch").mockResolvedValue(undefined);
      const fetchBalancesSpy = vi.spyOn(qBalances, "fetch").mockResolvedValue(undefined);

      // Signal at 42 arrives
      await handleGroupSignal(client, "g-1", 42);

      expect(fetchMembersSpy).not.toHaveBeenCalled();
      expect(fetchExpensesSpy).toHaveBeenCalledTimes(1);
      expect(fetchBalancesSpy).toHaveBeenCalledTimes(1);
    });

    it("a signal arriving before the writer's own response never lets the older response overwrite newer data", async () => {
      const queryKey = ["groups", "g-1", "expenses"];
      const obs = new QueryObserver(client, { queryKey });
      obs.subscribe(() => {});

      // Step 1: Writer had in-flight call that was dispatched when rev was 40.
      const slowOlderResponse = new Response(JSON.stringify({ expenses: [{ id: "e-old" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json", "X-Group-Rev": "40" },
      });

      // Step 2: Meanwhile, WebSocket signal at rev 42 arrives and sets newer data at rev 42.
      client.setQueryData(queryKey, { expenses: [{ id: "e-new" }] });
      setQueryRev(client, queryKey, 42);

      // Step 3: Now slow older response at rev 40 finishes and calls readWithRev.
      const ctx = { client, queryKey };
      const result = await readWithRev<{ expenses: Array<{ id: string }> }>(
        Promise.resolve(slowOlderResponse),
        ctx,
      );

      // It must return the newer data, NOT the older response!
      expect(result).toEqual({ expenses: [{ id: "e-new" }] });
      expect(getQueryRev(client, queryKey)).toBe(42);
    });

    it("after writer's mutation returns rev N, it invalidates the other queries rather than marking them as N", () => {
      client.getQueryCache().build(client, {
        queryKey: ["groups", "g-1"],
      });
      client.getQueryCache().build(client, {
        queryKey: ["groups", "g-1", "members"],
      });
      client.getQueryCache().build(client, {
        queryKey: ["groups", "g-1", "expenses"],
      });

      setQueryRev(client, ["groups", "g-1"], 40);
      setQueryRev(client, ["groups", "g-1", "members"], 40);
      setQueryRev(client, ["groups", "g-1", "expenses"], 40);

      const invalidateSpy = vi.spyOn(client, "invalidateQueries");

      // Mutation updated group details at rev 42
      onGroupMutationSuccess(client, "g-1", 42, { updatedQueryKey: ["groups", "g-1"] });

      // Group itself is marked as 42
      expect(getQueryRev(client, ["groups", "g-1"])).toBe(42);

      // The other queries are NOT marked as 42! Their rev remains 40.
      expect(getQueryRev(client, ["groups", "g-1", "members"])).toBe(40);
      expect(getQueryRev(client, ["groups", "g-1", "expenses"])).toBe(40);

      // And the other queries were invalidated
      expect(invalidateSpy).toHaveBeenCalled();
    });
  });
});
