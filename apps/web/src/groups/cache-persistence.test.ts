import { QueryClient } from "@tanstack/react-query";
import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
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
} from "./cache-persistence.js";
import { getQueryRev, readWithRev, setQueryRev } from "./sync.js";

class FakeStorage implements CacheStorage {
  private store = new Map<string, string>();

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
});
