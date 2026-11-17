import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import {
  dailyMaintenance,
  FLIGHTS_CRON,
  MAINTENANCE_CRON,
  runScheduled,
} from "../src/maintenance.js";
import type { AccountDeletionOperation } from "../src/ledger-types.js";
import { bearer, call, clock } from "./auth-harness.js";
import { groupWith } from "./groups-harness.js";

function unavailableCommits() {
  return new Proxy(env.GROUP_LEDGER, {
    get(namespace, property) {
      if (property === "get")
        return (id: DurableObjectId) =>
          new Proxy(namespace.get(id), {
            get(stub, key) {
              if (key === "accountDeletion")
                return (op: AccountDeletionOperation) => {
                  if (op.action === "commit")
                    return Promise.resolve({ ok: false, code: "INTERNAL" });
                  return stub.accountDeletion(op);
                };
              const value: unknown = Reflect.get(stub, key, stub);
              return typeof value === "function"
                ? (...args: unknown[]): unknown => Reflect.apply(value, stub, args)
                : value;
            },
          });
      const value: unknown = Reflect.get(namespace, property, namespace);
      return typeof value === "function" ? (value.bind(namespace) as unknown) : value;
    },
  });
}

it("daily maintenance purges expired sessions and commits pending account cleanups before refreshing rates", async () => {
  const { admin, group, others } = await groupWith("Maintenance owner", "Deleted account");
  const departing = others[0];
  if (!departing) throw new Error("missing member");
  const deleted = await call(
    "/me",
    { method: "DELETE", headers: bearer(departing.accessToken) },
    {
      GROUP_LEDGER: unavailableCommits(),
    },
  );
  expect(deleted.status).toBe(204);
  expect(
    await env.DB.prepare("SELECT count(*) AS n FROM account_cleanups WHERE user_id=?")
      .bind(departing.userId)
      .first(),
  ).toEqual({ n: 1 });
  await env.DB.prepare("UPDATE sessions SET expires_at=? WHERE user_id=?")
    .bind(clock.now - 1, admin.userId)
    .run();
  const date = new Date(clock.now).toISOString().slice(0, 10);
  const atRateFetch: { sessions: number; cleanups: number }[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const sessions = await env.DB.prepare("SELECT count(*) AS n FROM sessions WHERE user_id=?")
      .bind(admin.userId)
      .first<{ n: number }>();
    const cleanups = await env.DB.prepare(
      "SELECT count(*) AS n FROM account_cleanups WHERE user_id=?",
    )
      .bind(departing.userId)
      .first<{ n: number }>();
    atRateFetch.push({ sessions: sessions?.n ?? -1, cleanups: cleanups?.n ?? -1 });
    const url = new URL(input instanceof Request ? input.url : input.toString());
    return Response.json({ date, rates: { [url.searchParams.get("symbols") ?? ""]: 1 } });
  });
  try {
    await dailyMaintenance(env, clock.now);
    expect(atRateFetch.length).toBeGreaterThan(0);
    expect(atRateFetch.every((state) => state.sessions === 0 && state.cleanups === 0)).toBe(true);
    const stub = env.GROUP_LEDGER.get(env.GROUP_LEDGER.idFromName(group.id));
    expect(
      await runInDurableObject(stub, (_instance, state) =>
        state.storage.sql
          .exec("SELECT user_id FROM account_finalizations WHERE user_id=?", departing.userId)
          .toArray(),
      ),
    ).toEqual([]);
    expect(
      await env.DB.prepare(
        "SELECT rate_scaled FROM fx_rates WHERE base_currency='USD' AND quote_currency='TWD' AND rate_date=?",
      )
        .bind(date)
        .first(),
    ).toEqual({ rate_scaled: 1_000_000 });
  } finally {
    vi.unstubAllGlobals();
  }
});

it("runScheduled dispatches 08:00 GMT+8 (0 0 * * *) exclusively for flights and 30 16 * * * for cleanup/rates", async () => {
  const seenUrls: string[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : input.toString();
    seenUrls.push(url);
    return Promise.resolve(
      url.includes("travelpayouts.com")
        ? Response.json({ success: true, data: [] })
        : Response.json({ date: "2026-11-16", rates: { TWD: 32 } }),
    );
  });
  try {
    await runScheduled(FLIGHTS_CRON, { ...env, TRAVELPAYOUTS_TOKEN: "tp-test" }, clock.now);
    expect(seenUrls.some((u) => u.includes("travelpayouts.com"))).toBe(true);
    expect(seenUrls.some((u) => u.includes("frankfurter") || u.includes("er-api"))).toBe(false);

    seenUrls.length = 0;
    await runScheduled(MAINTENANCE_CRON, { ...env, TRAVELPAYOUTS_TOKEN: "tp-test" }, clock.now);
    expect(seenUrls.some((u) => u.includes("travelpayouts.com"))).toBe(false);
    expect(seenUrls.length).toBeGreaterThan(0);

    seenUrls.length = 0;
    await runScheduled("", { ...env, TRAVELPAYOUTS_TOKEN: "tp-test" }, clock.now);
    expect(seenUrls.some((u) => u.includes("travelpayouts.com"))).toBe(true);
    expect(seenUrls.some((u) => !u.includes("travelpayouts.com"))).toBe(true);
  } finally {
    vi.unstubAllGlobals();
  }
});

describe("flights cron as a fallback (ADR 0012)", () => {
  const hoursAgo = (h: number) => clock.now - h * 3_600_000;
  async function flightsCronCalls(completedAt: number | null): Promise<number> {
    await env.DB.prepare("DELETE FROM daily_flights_runs").run();
    if (completedAt !== null) {
      await env.DB.prepare(
        "INSERT INTO daily_flights_runs (id, digest_date, completed_at) VALUES (1, '2026-11-16', ?)",
      )
        .bind(completedAt)
        .run();
    }
    let calls = 0;
    vi.stubGlobal("fetch", () => {
      calls += 1;
      return Promise.resolve(Response.json({ success: true, data: [] }));
    });
    try {
      await runScheduled(FLIGHTS_CRON, { ...env, TRAVELPAYOUTS_TOKEN: "tp-test" }, clock.now);
    } finally {
      vi.unstubAllGlobals();
    }
    return calls;
  }

  it("skips when a sync completed within 20 hours", async () => {
    expect(await flightsCronCalls(hoursAgo(1))).toBe(0);
    expect(await flightsCronCalls(hoursAgo(19.9))).toBe(0);
  });

  it("syncs when the marker is stale or missing", async () => {
    expect(await flightsCronCalls(hoursAgo(20))).toBeGreaterThan(0);
    expect(await flightsCronCalls(hoursAgo(30))).toBeGreaterThan(0);
    expect(await flightsCronCalls(null)).toBeGreaterThan(0);
  });
});
