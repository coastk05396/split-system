import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { bearer, call } from "./auth-harness.js";
import { createGroup, person } from "./groups-harness.js";

/** The real namespace, recording which Group names were looked up. */
function watchedLedger() {
  const names: string[] = [];
  const GROUP_LEDGER = {
    idFromName: (name: string) => {
      names.push(name);
      return env.GROUP_LEDGER.idFromName(name);
    },
    get: (id: DurableObjectId) => env.GROUP_LEDGER.get(id),
  } as unknown as typeof env.GROUP_LEDGER;
  return { names, GROUP_LEDGER };
}

describe("X-Group-Rev on Group reads", () => {
  it("never wakes a Group's ledger for an anonymous caller", async () => {
    const { names, GROUP_LEDGER } = watchedLedger();

    const res = await call("/groups/any-name-at-all/balances", {}, { GROUP_LEDGER });

    expect(res.status).toBe(401);
    expect(res.headers.has("X-Group-Rev")).toBe(false);
    expect(names).toEqual([]);
  });

  it("neither wakes the ledger nor shows its revision to a signed-in non-Member", async () => {
    const admin = await person("owner");
    const group = await createGroup(admin);
    const outsider = await person("outsider");
    const { names, GROUP_LEDGER } = watchedLedger();

    const res = await call(
      `/groups/${group.id}/balances`,
      { headers: bearer(outsider.accessToken) },
      { GROUP_LEDGER },
    );

    expect(res.status).toBe(404);
    expect(res.headers.has("X-Group-Rev")).toBe(false);
    expect(names).toEqual([]);
  });

  it("keeps the revision off a rejected request, even from a Member", async () => {
    const admin = await person("rejected");
    const group = await createGroup(admin);

    const res = await call(`/groups/${group.id}/no-such-page`, {
      headers: bearer(admin.accessToken),
    });

    expect(res.status).toBe(404);
    expect(res.headers.has("X-Group-Rev")).toBe(false);
  });

  it("treats an anonymous HEAD like an anonymous GET", async () => {
    const { names, GROUP_LEDGER } = watchedLedger();

    await call("/groups/any-name-at-all/balances", { method: "HEAD" }, { GROUP_LEDGER });

    expect(names).toEqual([]);
  });

  it("still gives a Member the revision of the Group they read", async () => {
    const admin = await person("member");
    const group = await createGroup(admin);

    const res = await call(`/groups/${group.id}/balances`, { headers: bearer(admin.accessToken) });

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Group-Rev")).toMatch(/^\d+$/);
  });
});
