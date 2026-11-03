import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { commitAccountCleanups } from "../src/auth/account-cleanup.js";
import { bearer, call } from "./auth-harness.js";
import { createGroup, groupWith, person } from "./groups-harness.js";

function deleteMe(accessToken: string, bindings = {}) {
  return call("/me", { method: "DELETE", headers: bearer(accessToken) }, bindings);
}

/** Rows of a Group's ledger, read straight from its storage. */
function ledgerRows(groupId: string, query: string, ...values: string[]) {
  const stub = env.GROUP_LEDGER.get(env.GROUP_LEDGER.idFromName(groupId));
  return runInDurableObject(stub, (_instance, state) =>
    state.storage.sql.exec(query, ...values).toArray(),
  );
}

const identifying = (groupId: string, userId: string) =>
  Promise.all([
    ledgerRows(groupId, "SELECT * FROM account_finalizations WHERE user_id=?", userId),
    ledgerRows(groupId, "SELECT * FROM account_freezes WHERE user_id=?", userId),
    ledgerRows(groupId, "SELECT id FROM ledger_members WHERE user_id=?", userId),
  ]);

describe("after an account is deleted for good", () => {
  it("leaves no rollback or freeze record of the User in a Group that carries on", async () => {
    const { group, others } = await groupWith("admin", "departing");
    const departing = others[0];
    if (departing === undefined) throw new Error("missing member");

    expect((await deleteMe(departing.accessToken)).status).toBe(204);

    expect(await identifying(group.id, departing.userId)).toEqual([[], [], []]);
  });

  it("leaves no trace of the User in the Group that was theirs alone", async () => {
    const user = await person("solo");
    const group = await createGroup(user);

    expect((await deleteMe(user.accessToken)).status).toBe(204);

    expect(await identifying(group.id, user.userId)).toEqual([[], [], []]);
  });

  it("finishes the clean-up later when the ledger could not be reached right after", async () => {
    const { group, others } = await groupWith("admin", "departing");
    const departing = others[0];
    if (departing === undefined) throw new Error("missing member");
    const flaky = {
      idFromName: (name: string) => env.GROUP_LEDGER.idFromName(name),
      get: (id: DurableObjectId) => {
        const stub = env.GROUP_LEDGER.get(id);
        return {
          fetch: (url: string, init?: RequestInit) => {
            if (typeof init?.body === "string" && init.body.includes('"commit"'))
              throw new Error("ledger unreachable");
            return stub.fetch(url, init);
          },
        };
      },
    } as unknown as typeof env.GROUP_LEDGER;

    expect((await deleteMe(departing.accessToken, { GROUP_LEDGER: flaky })).status).toBe(204);
    const [kept] = await identifying(group.id, departing.userId);
    expect(kept).toHaveLength(1); // the rollback copy waits for the retry

    await commitAccountCleanups(env);

    expect(await identifying(group.id, departing.userId)).toEqual([[], [], []]);
  });
});
