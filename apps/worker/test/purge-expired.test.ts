import { runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { purgeExpired } from "../src/maintenance.js";
import { bearer, call, signIn, uniqueSub } from "./auth-harness.js";

import { failDirectoryWrites } from "./d1-faults.js";
import { groupWith, listMembers, person, send } from "./groups-harness.js";

const NOW = 1_750_000_000_000;
const HOUR = 3_600_000;

async function count(table: "sessions" | "rate_counters", userId: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE user_id=?`)
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

describe("purgeExpired", () => {
  it("drops lapsed sessions and old rate counters, and keeps the live ones", async () => {
    const { userId } = await signIn("google", uniqueSub("purge"));
    await env.DB.batch([
      env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(userId),
      env.DB.prepare(
        "INSERT INTO sessions(id,user_id,refresh_token_hash,expires_at,created_at) VALUES (?,?,?,?,?)",
      ).bind("gone", userId, "hash-gone", NOW - 1, NOW - 2),
      env.DB.prepare(
        "INSERT INTO sessions(id,user_id,refresh_token_hash,expires_at,created_at) VALUES (?,?,?,?,?)",
      ).bind("live", userId, "hash-live", NOW + 1, NOW - 2),
      env.DB.prepare(
        "INSERT INTO rate_counters(user_id,route_group,window_start,count) VALUES (?,?,?,1)",
      ).bind(userId, "expense_write", NOW - 2 * HOUR),
      env.DB.prepare(
        "INSERT INTO rate_counters(user_id,route_group,window_start,count) VALUES (?,?,?,1)",
      ).bind(userId, "expense_write", NOW - HOUR / 2),
    ]);

    await purgeExpired(env, NOW);

    expect(await count("sessions", userId)).toBe(1);
    expect(await count("rate_counters", userId)).toBe(1);
  });

  it("drops pending Group reservations older than a day, and keeps fresh and active ones", async () => {
    const { userId } = await signIn("google", uniqueSub("reservations"));
    const reserve = (groupId: string, status: string, createdAt: number) =>
      env.DB.prepare(
        "INSERT INTO group_reservations(user_id,group_id,status,created_at) VALUES (?,?,?,?)",
      ).bind(userId, groupId, status, createdAt);
    await env.DB.batch([
      reserve("stale-pending", "pending", NOW - 25 * HOUR),
      reserve("fresh-pending", "pending", NOW - HOUR),
      reserve("old-active", "active", NOW - 90 * 24 * HOUR),
    ]);

    await purgeExpired(env, NOW);

    const left = await env.DB.prepare(
      "SELECT group_id FROM group_reservations WHERE user_id=? ORDER BY group_id",
    )
      .bind(userId)
      .all<{ group_id: string }>();
    expect(left.results.map((r) => r.group_id)).toEqual(["fresh-pending", "old-active"]);
  });

  it("keeps a committed membership through delayed projection, capacity checks and account deletion", async () => {
    const { admin, group, token } = await groupWith("Reservation owner");
    const member = await person("Delayed member");
    const restore = await failDirectoryWrites();
    try {
      expect((await send(member, "POST", `/invites/${token}/join`)).status).toBe(200);
      await env.DB.prepare(
        "UPDATE group_reservations SET created_at=? WHERE user_id=? AND group_id=?",
      )
        .bind(NOW - 25 * HOUR, member.userId, group.id)
        .run();
      await purgeExpired(env, NOW);
      // The ledger says they are seated: the row is kept and settled, so it cannot sit among
      // the oldest pending rows and crowd out reservations that really failed.
      expect(
        await env.DB.prepare("SELECT status FROM group_reservations WHERE user_id=? AND group_id=?")
          .bind(member.userId, group.id)
          .first(),
      ).toEqual({ status: "active" });
    } finally {
      await restore();
    }
    await runDurableObjectAlarm(env.GROUP_LEDGER.get(env.GROUP_LEDGER.idFromName(group.id)));
    expect(
      await env.DB.prepare("SELECT status FROM group_reservations WHERE user_id=? AND group_id=?")
        .bind(member.userId, group.id)
        .first(),
    ).toEqual({ status: "active" });
    await env.DB.batch(
      Array.from({ length: 19 }, (_, i) =>
        env.DB.prepare(
          "INSERT INTO group_reservations(user_id,group_id,status,created_at) VALUES (?,?,'active',?)",
        ).bind(member.userId, `capacity-${i}`, NOW),
      ),
    );
    const full = await send(member, "POST", "/groups", { name: "Over the allowance" });
    expect(full.status).toBe(409);
    expect(await full.json()).toMatchObject({ error: { code: "GROUP_LIMIT_REACHED" } });
    await env.DB.prepare("DELETE FROM group_reservations WHERE user_id=? AND group_id!=?")
      .bind(member.userId, group.id)
      .run();
    expect(
      (await call("/me", { method: "DELETE", headers: bearer(member.accessToken) })).status,
    ).toBe(204);
    expect(await listMembers(admin, group.id)).toContainEqual(
      expect.objectContaining({
        userId: null,
        status: "former",
        displayName: "已刪除的使用者",
      }),
    );
  });

  it("keeps stale reservations when the ledger cannot be reached without aborting maintenance", async () => {
    const { userId } = await signIn("google", uniqueSub("unreachable"));
    await env.DB.prepare(
      "INSERT INTO group_reservations(user_id,group_id,status,created_at) VALUES (?,?,'pending',?)",
    )
      .bind(userId, "unreachable-ledger", NOW - 25 * HOUR)
      .run();
    const unavailable = new Proxy(env.GROUP_LEDGER, {
      get(namespace, key) {
        if (key === "get")
          return () => ({ fetch: () => Promise.reject(new Error("ledger unreachable")) });
        const value: unknown = Reflect.get(namespace, key, namespace);
        return typeof value === "function" ? (value.bind(namespace) as unknown) : value;
      },
    });
    await expect(purgeExpired({ ...env, GROUP_LEDGER: unavailable }, NOW)).resolves.toBeUndefined();
    expect(
      await env.DB.prepare("SELECT group_id FROM group_reservations WHERE user_id=?")
        .bind(userId)
        .all(),
    ).toMatchObject({ results: [{ group_id: "unreachable-ledger" }] });
  });

  it("checks at most 100 stale reservations per run, oldest first", async () => {
    const { userId } = await signIn("google", uniqueSub("bounded purge"));
    await env.DB.batch(
      Array.from({ length: 101 }, (_, i) =>
        env.DB.prepare(
          "INSERT INTO group_reservations(user_id,group_id,status,created_at) VALUES (?,?,'pending',?)",
        ).bind(userId, `bounded-${i}`, NOW - 26 * HOUR - i),
      ),
    );
    await purgeExpired(env, NOW);
    expect(
      await env.DB.prepare("SELECT group_id FROM group_reservations WHERE user_id=?")
        .bind(userId)
        .all(),
    ).toMatchObject({ results: [{ group_id: "bounded-0" }] });
    await purgeExpired(env, NOW);
    expect(
      await env.DB.prepare("SELECT group_id FROM group_reservations WHERE user_id=?")
        .bind(userId)
        .all(),
    ).toMatchObject({ results: [] });
  });

  it("keeps a reservation when its membership check times out", async () => {
    const { userId } = await signIn("google", uniqueSub("timed-out check"));
    await env.DB.prepare(
      "INSERT INTO group_reservations(user_id,group_id,status,created_at) VALUES (?,?,'pending',?)",
    )
      .bind(userId, "stalled-ledger", NOW - 25 * HOUR)
      .run();
    const signals: (AbortSignal | null | undefined)[] = [];
    const stalled = new Proxy(env.GROUP_LEDGER, {
      get(namespace, key) {
        if (key === "get")
          return () => ({
            fetch: (_input: RequestInfo | URL, init?: RequestInit) =>
              new Promise<Response>((_resolve, reject) => {
                const signal = init?.signal;
                signals.push(signal);
                if (!signal) {
                  reject(new Error("no deadline"));
                  return;
                }
                signal.addEventListener(
                  "abort",
                  () => {
                    reject(signal.reason as Error);
                  },
                  { once: true },
                );
              }),
          });
        const value: unknown = Reflect.get(namespace, key, namespace);
        return typeof value === "function" ? (value.bind(namespace) as unknown) : value;
      },
    });
    await purgeExpired({ ...env, GROUP_LEDGER: stalled }, NOW);
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((signal) => signal?.aborted === true)).toBe(true);
    expect(
      await env.DB.prepare("SELECT group_id FROM group_reservations WHERE user_id=?")
        .bind(userId)
        .all(),
    ).toMatchObject({ results: [{ group_id: "stalled-ledger" }] });
  }, 15_000);

  it("does not abort daily maintenance when the reservation inventory cannot be read", async () => {
    const unavailable = new Proxy(env.DB, {
      get(database, key) {
        if (key === "prepare")
          return (query: string) => {
            if (query.includes("group_reservations")) throw new Error("inventory unavailable");
            return database.prepare(query);
          };
        const value: unknown = Reflect.get(database, key, database);
        return typeof value === "function" ? (value.bind(database) as unknown) : value;
      },
    });
    await expect(purgeExpired({ ...env, DB: unavailable }, NOW)).resolves.toBeUndefined();
  });
});
