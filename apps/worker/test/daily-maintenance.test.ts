import { productionDeps } from "../src/deps.js";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, it, vi } from "vitest";
import { dailyMaintenance } from "../src/maintenance.js";
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
    await dailyMaintenance(env, clock.now, {
      ...productionDeps,
      flightSource: () => Promise.reject(new Error("offline flight source")),
    });
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
