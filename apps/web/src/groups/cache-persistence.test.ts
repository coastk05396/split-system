import { QueryClient } from "@tanstack/react-query";
import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import { renderApp } from "../../test/render-app.js";
import {
  CACHE_VERSION,
  type CacheStorage,
  clearCache,
  getCacheKey,
  isQueryRestored,
  restoreCache,
  saveCache,
  setQueryRestored,
  startCachePersistence,
} from "./cache-persistence.js";
import { getQueryRev, readWithRev, setQueryRev } from "./data.js";

class FakeStorage implements CacheStorage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

describe("Web query cache persistence (Ticket 10)", () => {
  let client: QueryClient;
  let storage: FakeStorage;

  beforeEach(() => {
    client = new QueryClient();
    storage = new FakeStorage();
  });

  afterEach(() => vi.useRealTimers());

  it("coalesces many query successes into one trailing cache write", async () => {
    vi.useFakeTimers();
    const writes = vi.spyOn(storage, "setItem");
    const stop = startCachePersistence(client, "user-1", storage);
    try {
      for (let i = 0; i < 10; i++) client.setQueryData(["groups", i], { id: i });
      expect(writes).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(500);
      client.setQueryData(["groups", 10], { id: 10 });
      await vi.advanceTimersByTimeAsync(999);
      expect(writes).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(writes).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  it("flushes a pending cache write on pagehide without a later duplicate", async () => {
    vi.useFakeTimers();
    const writes = vi.spyOn(storage, "setItem");
    const stop = startCachePersistence(client, "user-1", storage);
    try {
      client.setQueryData(["groups", "g-1"], { name: "Before leaving" });
      window.dispatchEvent(new Event("pagehide"));
      expect(writes).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2000);
      expect(writes).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  it("sign-out cancels pending cache writes after coalescing query successes", async () => {
    const user = makeUser("Debounced cache");
    let groupId = "";
    const { api, router, queryClient } = renderApp({
      cookieUser: user,
      path: "/groups",
      cacheStorage: storage,
      seed: (groups) => {
        groupId = groups.add(user, { name: "Debounced ledger" });
      },
    });
    await screen.findByRole("list", { name: "我的群組" });
    vi.useFakeTimers();
    const writes = vi.spyOn(storage, "setItem");
    act(() => {
      for (let i = 0; i < 10; i++) queryClient.setQueryData(["cache-burst", i], i);
    });
    expect(writes).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(writes).toHaveBeenCalledTimes(1);
    act(() => {
      queryClient.setQueryData(["cache-burst", 11], 11);
    });
    api.expireAccessToken();
    api.setCookieUser(null);
    await act(async () => {
      await router.navigate(`/groups/${groupId}`);
      await vi.advanceTimersByTimeAsync(100);
    });
    await vi.waitFor(() => {
      expect(storage.getItem(getCacheKey(user.id))).toBeNull();
    });
    writes.mockClear();
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(writes).not.toHaveBeenCalled();
    expect(storage.getItem(getCacheKey(user.id))).toBeNull();
  });

  it("the cache is restored per user and never shown to a different user", () => {
    // Populate cache for user 1
    client.setQueryData(["groups", "g-1"], { id: "g-1", name: "台南之旅" });
    setQueryRev(client, ["groups", "g-1"], 10);
    saveCache(client, "user-1", storage);

    // Another user starts with a clean client
    const user2Client = new QueryClient();
    const restoredForUser2 = restoreCache(user2Client, "user-2", storage);
    expect(restoredForUser2).toBe(false);
    expect(user2Client.getQueryData(["groups", "g-1"])).toBeUndefined();

    // User 1 restores on a fresh client
    const user1Client = new QueryClient();
    const restoredForUser1 = restoreCache(user1Client, "user-1", storage);
    expect(restoredForUser1).toBe(true);
    expect(user1Client.getQueryData(["groups", "g-1"])).toEqual({ id: "g-1", name: "台南之旅" });
    expect(getQueryRev(user1Client, ["groups", "g-1"])).toBe(10);
  });

  it("a different version string discards the cache", () => {
    // Save cache under an old version
    storage.setItem(
      getCacheKey("user-1", "split.v0"),
      JSON.stringify({
        version: "split.v0",
        userId: "user-1",
        queries: [{ queryKey: ["groups", "g-1"], data: { id: "g-1" } }],
      }),
    );

    const client1 = new QueryClient();
    const restored = restoreCache(client1, "user-1", storage, CACHE_VERSION);
    expect(restored).toBe(false);
    expect(client1.getQueryData(["groups", "g-1"])).toBeUndefined();
  });

  it("sign-out clears the cache", () => {
    client.setQueryData(["groups", "g-1"], { id: "g-1" });
    saveCache(client, "user-1", storage);
    expect(storage.getItem(getCacheKey("user-1"))).not.toBeNull();

    clearCache("user-1", storage);
    expect(storage.getItem(getCacheKey("user-1"))).toBeNull();
  });

  it("forced sign-out removes every persisted ledger cache", async () => {
    const user = makeUser("Revoked session");
    let groupId = "";
    const { api, router } = renderApp({
      cookieUser: user,
      path: "/groups",
      seed: (groups) => {
        groupId = groups.add(user, { name: "Private ledger" });
      },
    });
    await screen.findByRole("list", { name: "我的群組" });
    await waitFor(() => {
      expect(localStorage.getItem(getCacheKey(user.id))).not.toBeNull();
    });
    localStorage.setItem("split.queryCache.other.split.v0", "older private ledger");
    localStorage.setItem("split.queryCache.other.split.v1", "another private ledger");
    localStorage.setItem("split.locale", "zh-TW");
    api.expireAccessToken();
    api.setCookieUser(null);
    await act(() => router.navigate(`/groups/${groupId}`));
    await screen.findByRole("button", { name: "使用 Google 登入" });
    expect(
      Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((key) =>
        key?.startsWith("split.queryCache."),
      ),
    ).toEqual([]);
    expect(localStorage.getItem("split.locale")).toBe("zh-TW");
  });

  it("a restored amount shows the updating state and becomes solid only after confirmation", async () => {
    // Restore query
    client.setQueryData(["groups", "g-1", "balances"], { balances: [{ amount: 500 }] });
    setQueryRestored(client, ["groups", "g-1", "balances"], true);

    expect(isQueryRestored(client, ["groups", "g-1", "balances"])).toBe(true);

    // Fresh response arrives from network and confirms the query
    const res = new Response(JSON.stringify({ balances: [{ amount: 500 }] }), {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Group-Rev": "11" },
    });
    const ctx = { client, queryKey: ["groups", "g-1", "balances"] };
    await readWithRev(Promise.resolve(res), ctx);

    // After confirmation, it is no longer in updating state (becomes solid)
    expect(isQueryRestored(client, ["groups", "g-1", "balances"])).toBe(false);
  });

  it("persists queries to storage on render and restores them on subsequent visits", async () => {
    const user = makeUser("小宇");
    const fakeStore = new FakeStorage();
    renderApp({
      cookieUser: user,
      cacheStorage: fakeStore,
      seed: (groups) => {
        groups.add(user, { name: "台南之旅", settlementCurrency: "TWD" });
      },
    });

    await waitFor(() => {
      expect(fakeStore.getItem(getCacheKey(user.id))).not.toBeNull();
    });
  });

  it("filters out optimistic items with tmp- IDs from infinite query structures", () => {
    client.setQueryData(["groups", "g-1", "expenses"], {
      pages: [
        {
          expenses: [{ id: "tmp-12345", description: "午餐", amount: 200 }],
          nextCursor: null,
        },
      ],
      pageParams: [undefined],
    });
    client.setQueryData(["groups", "g-1", "members"], [{ id: "m-1", name: "小宇" }]);

    saveCache(client, "user-1", storage);

    const user1Client = new QueryClient();
    restoreCache(user1Client, "user-1", storage);

    // The query containing tmp- ID is omitted from cache
    expect(user1Client.getQueryData(["groups", "g-1", "expenses"])).toBeUndefined();
    // The clean query is preserved
    expect(user1Client.getQueryData(["groups", "g-1", "members"])).toEqual([
      { id: "m-1", name: "小宇" },
    ]);
  });
});
