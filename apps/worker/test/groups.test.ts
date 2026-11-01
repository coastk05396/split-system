import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { createDb } from "../src/db/client.js";
import { expenses, groups, members } from "../src/db/schema.js";
import { bearer, call, clock, signIn, uniqueSub, type Session } from "./auth-harness.js";
import { failDirectoryWrites } from "./d1-faults.js";
import { createExpense, twdExpense } from "./expenses-harness.js";
import {
  at,
  createGroup,
  errorCode,
  type GroupBody,
  groupWith,
  person,
  send,
} from "./groups-harness.js";

const db = createDb(env.DB);

describe("a Group's member preview", () => {
  it("lists the first four seated Members in joining order, for the card's avatars", async () => {
    const { admin, group } = await groupWith("小宇", "甲", "乙", "丙", "丁", "戊");
    const list = await (
      await send(admin, "GET", "/groups")
    ).json<{ id: string; memberCount: number; memberPreview: { name: string }[] }[]>();
    const mine = list.find((g) => g.id === group.id);

    expect(mine?.memberCount).toBe(6);
    expect(mine?.memberPreview.map((m) => m.name)).toEqual(["小宇", "甲", "乙", "丙"]);
  });
});

describe("POST /groups and GET /groups/:id", () => {
  it("returns the Group revision on creation and subsequent reads", async () => {
    const yu = await person("小宇");
    const created = await send(yu, "POST", "/groups", { name: "版本測試" });
    expect(created.status).toBe(201);
    expect(created.headers.get("X-Group-Rev")).toBe("0");
    const group = await created.json<GroupBody>();
    const read = await send(yu, "GET", `/groups/${group.id}`);
    expect(read.headers.get("X-Group-Rev")).toBe("0");
    const members = await send(yu, "GET", `/groups/${group.id}/members`);
    expect(Array.isArray(await members.json())).toBe(true);
    expect(members.headers.get("X-Group-Rev")).toBe("0");
    const edited = await send(
      yu,
      "PATCH",
      `/groups/${group.id}`,
      { name: "新版" },
      {
        "If-Match": String(group.updatedAt),
      },
    );
    expect(edited.status).toBe(200);
    expect(edited.headers.get("X-Group-Rev")).toBe("1");
    const removed = await send(yu, "DELETE", `/groups/${group.id}`);
    expect(removed.status).toBe(204);
    expect(removed.headers.get("X-Group-Rev")).toBe("2");
    const list = await (await send(yu, "GET", "/groups")).json<GroupBody[]>();
    expect(list.some((item) => item.id === group.id)).toBe(false);
  });

  it("never returns a revision newer than data when a concurrent write occurs during read", async () => {
    const yu = await person("小宇");
    const created = await send(yu, "POST", "/groups", { name: "並行測試" });
    expect(created.status).toBe(201);
    const group = await created.json<GroupBody>();
    expect(created.headers.get("X-Group-Rev")).toBe("0");

    const realNamespace = env.GROUP_LEDGER;
    const proxyNamespace = new Proxy(realNamespace, {
      get(targetNamespace, key) {
        if (key !== "get") {
          const value: unknown = Reflect.get(targetNamespace, key, targetNamespace);
          return typeof value === "function"
            ? (...args: unknown[]): unknown => Reflect.apply(value, targetNamespace, args)
            : value;
        }
        return (id: Parameters<typeof targetNamespace.get>[0]) => {
          const stub = targetNamespace.get(id);
          return new Proxy(stub, {
            get(targetStub, prop) {
              if (prop !== "fetch") {
                const value: unknown = Reflect.get(targetStub, prop, targetStub);
                return typeof value === "function"
                  ? (...args: unknown[]): unknown => Reflect.apply(value, targetStub, args)
                  : value;
              }
              return async (input: RequestInfo | URL, init?: RequestInit) => {
                const url =
                  typeof input === "string"
                    ? input
                    : input instanceof URL
                      ? input.toString()
                      : input.url;
                if (url.includes("/state")) {
                  const res = await targetStub.fetch(input, init);
                  // Trigger concurrent write to DO right after revision pre-fetch
                  await targetStub.fetch("https://ledger.internal/member-op", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      action: "add",
                      actorMemberId: group.me.memberId,
                      targetMemberId: crypto.randomUUID(),
                      input: { name: "並行寫入" },
                      now: Date.now(),
                    }),
                  });
                  return res;
                }
                return targetStub.fetch(input, init);
              };
            },
          });
        };
      },
    });

    // Balances are read from the ledger, so their revision comes from the pre-fetch.
    const read = await call(
      `/groups/${group.id}/balances`,
      { headers: bearer(yu.accessToken) },
      { GROUP_LEDGER: proxyNamespace },
    );
    expect(read.status).toBe(200);
    // Revision returned on the read response must be 0 (established before handler),
    // even though concurrent write advanced DO revision to 1.
    expect(read.headers.get("X-Group-Rev")).toBe("0");

    // Verify DO is at rev 1
    const current = await realNamespace
      .get(realNamespace.idFromName(group.id))
      .fetch("https://ledger.internal/state");
    const currentState = await current.json<{ rev: number }>();
    expect(currentState.rev).toBe(1);
  });
  it("labels a Members read with the projection's own revision, never the ledger's newer one", async () => {
    const yu = await person("小宇");
    const group = await createGroup(yu, { name: "投影版本" });
    expect((await send(yu, "POST", `/groups/${group.id}/members`, { name: "小明" })).status).toBe(
      201,
    );
    // Simulate a projection that has not caught up with the ledger yet.
    await env.DB.prepare("UPDATE group_directory SET rev = 0 WHERE group_id = ?")
      .bind(group.id)
      .run();
    const stub = env.GROUP_LEDGER.get(env.GROUP_LEDGER.idFromName(group.id));
    const state = await (await stub.fetch("https://ledger.internal/state")).json<{ rev: number }>();
    expect(state.rev).toBeGreaterThan(0);

    const read = await send(yu, "GET", `/groups/${group.id}/members`);
    expect(read.status).toBe(200);
    expect(read.headers.get("X-Group-Rev")).toBe("0");
  });
  it("creates a Running Tab with the creator as its only Member and Admin", async () => {
    const yu = await person("小宇");
    const group = await createGroup(yu, { name: "室友帳", settlementCurrency: "USD" });
    expect(group).toMatchObject({
      name: "室友帳",
      settlementCurrency: "USD",
      isTrip: false,
      tripDestination: null,
      settlementCurrencyLocked: false,
      memberCount: 1,
      memberPreview: [
        { name: "小宇", pictureUrl: expect.stringContaining("https://pic/") as unknown },
      ],
      me: { role: "admin", balance: 0 },
    });

    const res = await send(yu, "GET", `/groups/${group.id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(group);
  });

  it("creates a Trip with its destination and dates", async () => {
    const yu = await person("小宇");
    const group = await createGroup(yu, {
      isTrip: true,
      tripDestination: "台南",
      tripStartDate: "2026-06-13",
      tripEndDate: "2026-06-15",
    });
    expect(group).toMatchObject({
      isTrip: true,
      tripDestination: "台南",
      tripStartDate: "2026-06-13",
      tripEndDate: "2026-06-15",
    });
  });

  it("refuses a Trip longer than 31 days", async () => {
    const yu = await person("小宇");
    const res = await send(yu, "POST", "/groups", {
      name: "環島",
      isTrip: true,
      tripStartDate: "2026-06-01",
      tripEndDate: "2026-07-02",
    });
    expect(res.status).toBe(400);
  });

  it("answers 404 to a signed-in person who is not a Member", async () => {
    const group = await createGroup(await person("小宇"));
    const stranger = await person("路人");
    const res = await send(stranger, "GET", `/groups/${group.id}`);
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("NOT_FOUND");
  });

  it("requires sign-in", async () => {
    expect((await call("/groups", { method: "GET" })).status).toBe(401);
  });
});

describe("GET /groups", () => {
  it("shows the server-confirmed Balance after an Expense", async () => {
    const { admin, group } = await groupWith("小宇", "阿明");
    const members = await (
      await send(admin, "GET", `/groups/${group.id}/members`)
    ).json<{ id: string }[]>();
    const payer = at(members, 0).id;
    await createExpense(
      admin,
      group.id,
      twdExpense(
        payer,
        members.map((member) => member.id),
        600,
      ),
    );
    const list = await (await send(admin, "GET", "/groups")).json<GroupBody[]>();
    expect(list.find((item) => item.id === group.id)?.me.balance).toBe(300);
  });
  it("lists Groups when the ledgers cannot be reached", async () => {
    const yu = await person("小宇");
    const group = await createGroup(yu);
    const unavailable = new Proxy(env.GROUP_LEDGER, {
      get() {
        throw new Error("ledger unavailable");
      },
    });
    const response = await call(
      "/groups",
      { headers: bearer(yu.accessToken) },
      { GROUP_LEDGER: unavailable },
    );
    expect(response.status).toBe(200);
    expect((await response.json<GroupBody[]>()).map((item) => item.id)).toContain(group.id);
  });
  it("lists only the Groups the User is an active Member of", async () => {
    const yu = await person("小宇");
    const first = await createGroup(yu, { name: "室友帳" });
    const second = await createGroup(yu, { name: "台南" });
    await createGroup(await person("路人"), { name: "別人的" });
    const res = await send(yu, "GET", "/groups");
    expect(res.status).toBe(200);
    const list = await res.json<GroupBody[]>();
    expect(list.map((g) => g.id).sort()).toEqual([first.id, second.id].sort());
  });

  it("refuses a 21st Group for one User", async () => {
    const sub = uniqueSub("小宇");
    let yu = await signIn("google", sub, "小宇");
    for (let index = 0; index < 20; index++) {
      if (index > 0 && index % 5 === 0) {
        clock.now += 3_600_000;
        yu = await signIn("google", sub, "小宇");
      }
      await createGroup(yu, { name: "舊帳" });
    }
    clock.now += 3_600_000;
    yu = await signIn("google", sub, "小宇");
    const res = await send(yu, "POST", "/groups", { name: "第21個" });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("GROUP_LIMIT_REACHED");
  });

  it("does not let two concurrent creations exceed the Group cap", async () => {
    const sub = uniqueSub("Group cap race");
    let user = await signIn("google", sub, "Group cap race");
    for (let index = 0; index < 19; index++) {
      if (index > 0 && index % 5 === 0) {
        clock.now += 3_600_000;
        user = await signIn("google", sub, "Group cap race");
      }
      await createGroup(user, { name: "已有群組" });
    }
    clock.now += 3_600_000;
    user = await signIn("google", sub, "Group cap race");
    const results = await Promise.all([
      send(user, "POST", "/groups", { name: "第一個" }),
      send(user, "POST", "/groups", { name: "第二個" }),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([201, 409]);
  }, 20000);
});

describe("PATCH /groups/:id", () => {
  const patch = (s: Session, g: GroupBody, body: unknown, updatedAt = g.updatedAt) =>
    send(s, "PATCH", `/groups/${g.id}`, body, { "If-Match": String(updatedAt) });

  it("serializes competing edits and leaves the Group list at the winning revision", async () => {
    const yu = await person("小宇");
    const group = await createGroup(yu);
    const responses = await Promise.all([
      patch(yu, group, { name: "一" }),
      patch(yu, group, { name: "二" }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const winner = responses.find((response) => response.status === 200);
    if (winner === undefined) throw new Error("expected a winning edit");
    expect(winner.headers.get("X-Group-Rev")).toBe("1");
    const edited = await winner.json<GroupBody>();
    const list = await (await send(yu, "GET", "/groups")).json<GroupBody[]>();
    expect(list.find((item) => item.id === group.id)?.name).toBe(edited.name);
  });

  it("retries a failed directory push and keeps the Group edit available", async () => {
    const yu = await person("小宇");
    const group = await createGroup(yu);
    const restoreWrites = await failDirectoryWrites();
    try {
      const response = await patch(yu, group, { name: "等待同步" });
      expect(response.status).toBe(200);
      const first = await response.json<GroupBody>();
      expect(first.name).toBe("等待同步");
      const second = await patch(yu, first, { name: "最新版本" });
      expect(second.status).toBe(200);
      expect((await (await send(yu, "GET", `/groups/${group.id}`)).json<GroupBody>()).name).toBe(
        "最新版本",
      );
      const stale = await (await send(yu, "GET", "/groups")).json<GroupBody[]>();
      expect(stale.find((item) => item.id === group.id)?.name).toBe(group.name);
    } finally {
      await restoreWrites();
    }
    await vi.waitFor(
      async () => {
        const list = await (await send(yu, "GET", "/groups")).json<GroupBody[]>();
        expect(list.find((item) => item.id === group.id)?.name).toBe("最新版本");
      },
      { timeout: 8000, interval: 200 },
    );
  }, 12000);

  it("lets an Admin rename the Group and switch the Trip module on", async () => {
    const yu = await person("小宇");
    const group = await createGroup(yu);
    clock.now += 1000;
    const res = await patch(yu, group, {
      name: "台南三日",
      isTrip: true,
      tripStartDate: "2026-06-13",
      tripEndDate: "2026-06-15",
    });
    expect(res.status).toBe(200);
    const body = await res.json<GroupBody>();
    expect(body).toMatchObject({ name: "台南三日", isTrip: true, tripEndDate: "2026-06-15" });
    expect(body.updatedAt).toBeGreaterThan(group.updatedAt);
  });

  it("forbids a plain Member", async () => {
    const { group, others } = await groupWith("小宇", "阿明");
    const res = await patch(at(others, 0), group, { name: "改名" });
    expect(res.status).toBe(403);
  });

  it("answers 409 with the current Group when someone else edited it first", async () => {
    const yu = await person("小宇");
    const group = await createGroup(yu);
    clock.now += 1000;
    expect((await patch(yu, group, { name: "第一次" })).status).toBe(200);
    const res = await patch(yu, group, { name: "第二次" });
    expect(res.status).toBe(409);
    const body = await res.json<{ error: { code: string; details: { current: GroupBody } } }>();
    expect(body.error.code).toBe("EDIT_CONFLICT");
    expect(body.error.details.current.name).toBe("第一次");
  });

  it("requires If-Match", async () => {
    const yu = await person("小宇");
    const group = await createGroup(yu);
    const res = await send(yu, "PATCH", `/groups/${group.id}`, { name: "x" });
    expect(await errorCode(res)).toBe("IF_MATCH_REQUIRED");
  });

  it("refuses Trip dates that would make the Trip longer than 31 days", async () => {
    const yu = await person("小宇");
    const group = await createGroup(yu, { tripStartDate: "2026-06-01" });
    const res = await patch(yu, group, { tripEndDate: "2026-07-02" });
    expect(res.status).toBe(400);
  });

  it("locks the Settlement currency once the Group has an Expense", async () => {
    const yu = await person("小宇");
    const group = await createGroup(yu);
    clock.now += 1000;
    const changed = await patch(yu, group, { settlementCurrency: "USD" });
    expect(changed.status).toBe(200);
    const usd = await changed.json<GroupBody>();

    await createExpense(
      yu,
      group.id,
      twdExpense(usd.me.memberId, [usd.me.memberId], 600, { originalCurrency: "USD" }),
    );
    const locked = await send(yu, "GET", `/groups/${group.id}`);
    expect((await locked.json<GroupBody>()).settlementCurrencyLocked).toBe(true);

    clock.now += 1000;
    const res = await patch(yu, usd, { settlementCurrency: "TWD" });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("SETTLEMENT_CURRENCY_LOCKED");
  });
});

describe("DELETE /groups/:id", () => {
  it("lets an Admin hard-delete the Group with its Expenses", async () => {
    const yu = await person("小宇");
    const group = await createGroup(yu);
    await createExpense(yu, group.id, twdExpense(group.me.memberId, [group.me.memberId], 600));
    const res = await send(yu, "DELETE", `/groups/${group.id}`);
    expect(res.status).toBe(204);
    expect(await db.select().from(groups).where(eq(groups.id, group.id))).toEqual([]);
    expect(await db.select().from(expenses).where(eq(expenses.groupId, group.id))).toEqual([]);
    expect((await send(yu, "GET", `/groups/${group.id}`)).status).toBe(404);
  });

  it("forbids a plain Member and hides the Group from outsiders", async () => {
    const { group, others } = await groupWith("小宇", "阿明");
    expect((await send(at(others, 0), "DELETE", `/groups/${group.id}`)).status).toBe(403);
    const stranger = await person("路人");
    expect((await send(stranger, "DELETE", `/groups/${group.id}`)).status).toBe(404);
  });
});

describe("ledger actor validation", () => {
  it("rejects missing actors for patch and delete", async () => {
    const admin = await person("actor validation");
    const group = await createGroup(admin);
    const stub = env.GROUP_LEDGER.get(env.GROUP_LEDGER.idFromName(group.id));
    const patch = await stub.fetch("https://ledger.internal/patch", {
      method: "POST",
      body: JSON.stringify({
        patch: { name: "No actor" },
        expected: group.updatedAt,
        now: Date.now(),
      }),
    });
    const remove = await stub.fetch("https://ledger.internal/delete", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(patch.status).toBe(400);
    expect(remove.status).toBe(400);
  });
});

describe("ledger authority for admin actions (stale D1 projection)", () => {
  it("refuses PATCH and DELETE when D1 projection is stale and actor was demoted or removed in ledger", async () => {
    const { admin, group } = await groupWith("小宇", "阿明");

    const membersList = await (
      await send(admin, "GET", `/groups/${group.id}/members`)
    ).json<Array<{ id: string; displayName: string }>>();
    const mingMember = membersList.find((m) => m.displayName === "阿明");
    if (!mingMember) throw new Error("ming member not found");

    const promoteRes = await send(admin, "PATCH", `/groups/${group.id}/members/${mingMember.id}`, {
      role: "admin",
    });
    expect(promoteRes.status).toBe(200);

    const stub = env.GROUP_LEDGER.get(env.GROUP_LEDGER.idFromName(group.id));

    // Case 1: Actor is demoted in DO ledger, but D1 projection is stale (still says admin)
    const demoteRes = await stub.fetch("https://ledger.internal/member-op", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "patch",
        actorMemberId: mingMember.id,
        targetMemberId: group.me.memberId,
        input: { role: "member" },
        now: Date.now(),
      }),
    });
    expect(demoteRes.status).toBe(200);

    // Force D1 to be stale: set yu's role back to admin in D1 members table
    await db
      .update(members)
      .set({ role: "admin", status: "active" })
      .where(eq(members.id, group.me.memberId));

    // yu attempts PATCH: D1 filter passes, but DO ledger rejects with 403
    const patchRes = await send(
      admin,
      "PATCH",
      `/groups/${group.id}`,
      { name: "降級後偷改" },
      { "If-Match": String(group.updatedAt) },
    );
    expect(patchRes.status).toBe(403);

    // yu attempts DELETE: D1 filter passes, but DO ledger rejects with 403
    const deleteRes = await send(admin, "DELETE", `/groups/${group.id}`);
    expect(deleteRes.status).toBe(403);

    // Case 2: Actor is removed in DO ledger, but D1 projection is stale (still says active admin)
    const removeRes = await stub.fetch("https://ledger.internal/member-op", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "remove",
        actorMemberId: mingMember.id,
        targetMemberId: group.me.memberId,
        targetBalance: 0,
        now: Date.now(),
      }),
    });
    expect(removeRes.status).toBe(200);

    // Force D1 to be stale again: set yu's status back to active admin in D1
    await db
      .update(members)
      .set({ role: "admin", status: "active" })
      .where(eq(members.id, group.me.memberId));

    const patchRes2 = await send(
      admin,
      "PATCH",
      `/groups/${group.id}`,
      { name: "退出後偷改" },
      { "If-Match": String(group.updatedAt) },
    );
    expect(patchRes2.status).toBe(403);

    const deleteRes2 = await send(admin, "DELETE", `/groups/${group.id}`);
    expect(deleteRes2.status).toBe(403);
  });
});
