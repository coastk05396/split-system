import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { bearer, call } from "./auth-harness.js";
import { at, errorCode, groupWith, listMembers, person, send } from "./groups-harness.js";
import { createExpense, twdExpense } from "./expenses-harness.js";

describe("a Former Member's name", () => {
  it("never revives a nickname they once chose, but keeps the system label", async () => {
    const { admin, group, others } = await groupWith("小宇", "阿明");
    const mingSession = at(others, 0);

    // Ming leaves: status becomes former and display name stays 阿明
    const leaveRes = await send(mingSession, "POST", `/groups/${group.id}/leave`);
    expect(leaveRes.status).toBe(204);
    expect(at(await listMembers(admin, group.id), 1)).toMatchObject({
      displayName: "阿明",
      status: "former",
    });

    // When ming deletes their account, the system label "已刪除的使用者" is shown
    const deleteRes = await send(mingSession, "DELETE", "/me");
    expect(deleteRes.status).toBe(204);
    expect(at(await listMembers(admin, group.id), 1)).toMatchObject({
      displayName: "已刪除的使用者",
      status: "former",
    });
  });
});

describe("GET /groups/:id/members", () => {
  it("lists Members in joining order with their Balances", async () => {
    const { admin, group, others } = await groupWith("小宇", "阿明");
    const list = await listMembers(at(others, 0), group.id);
    expect(list.map((m) => [m.displayName, m.role, m.status, m.balance, m.isMe])).toEqual([
      ["小宇", "admin", "active", 0, false],
      ["阿明", "member", "active", 0, true],
    ]);
    expect(list[0]?.userId).toBe(admin.userId);
  });

  it("answers 404 to a non-member", async () => {
    const { group } = await groupWith("小宇");
    const stranger = await person("路人");
    expect((await send(stranger, "GET", `/groups/${group.id}/members`)).status).toBe(404);
  });
});

describe("PATCH /groups/:id/members/:mid", () => {
  it("lets any member rename placeholders while protecting joined members and names", async () => {
    const { admin, group, others } = await groupWith("小宇", "阿明");
    const created = await send(admin, "POST", `/groups/${group.id}/members`, { name: "成員1" });
    const placeholder: { id: string } = await created.json();
    const path = `/groups/${group.id}/members/${placeholder.id}`;
    const renamed = await send(at(others, 0), "PATCH", path, { placeholderName: "小明" });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({
      id: placeholder.id,
      displayName: "小明",
      status: "placeholder",
    });
    expect((await send(admin, "PATCH", path, { placeholderName: "阿明" })).status).toBe(409);
    const joined = at(await listMembers(admin, group.id), 1);
    expect(
      (
        await send(at(others, 0), "PATCH", `/groups/${group.id}/members/${joined.id}`, {
          placeholderName: "冒名",
        })
      ).status,
    ).toBe(409);
    expect(
      (await send(await person("路人"), "PATCH", path, { placeholderName: "冒名" })).status,
    ).toBe(404);
  });

  it("lets an Admin promote a Member, after which either Admin may be demoted", async () => {
    const { admin, group, others } = await groupWith("小宇", "阿明");
    const ming = at(await listMembers(admin, group.id), 1);
    const promoted = await send(admin, "PATCH", `/groups/${group.id}/members/${ming.id}`, {
      role: "admin",
    });
    expect(promoted.status).toBe(200);
    expect(await promoted.json()).toMatchObject({ id: ming.id, role: "admin" });

    const demoteYu = await send(
      at(others, 0),
      "PATCH",
      `/groups/${group.id}/members/${group.me.memberId}`,
      { role: "member" },
    );
    expect(demoteYu.status).toBe(200);
  });

  it("refuses to demote the last Admin", async () => {
    const { admin, group } = await groupWith("小宇", "阿明");
    const res = await send(admin, "PATCH", `/groups/${group.id}/members/${group.me.memberId}`, {
      role: "member",
    });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("LAST_ADMIN");
  });

  it("forbids a plain Member from changing roles", async () => {
    const { admin, group, others } = await groupWith("小宇", "阿明");
    const ming = at(await listMembers(admin, group.id), 1);
    const res = await send(at(others, 0), "PATCH", `/groups/${group.id}/members/${ming.id}`, {
      role: "admin",
    });
    expect(res.status).toBe(403);
  });

  it("no longer takes a Nickname: names come from LINE or Google", async () => {
    const { admin, group, others } = await groupWith("小宇", "阿明");
    const ming = at(await listMembers(admin, group.id), 1);
    const res = await send(at(others, 0), "PATCH", `/groups/${group.id}/members/${ming.id}`, {
      nickname: "明明",
    });
    expect(res.status).toBe(400);
    expect(at(await listMembers(admin, group.id), 1)).toMatchObject({ displayName: "阿明" });
  });

  it("answers 404 for a Member of another Group", async () => {
    const { admin, group } = await groupWith("小宇");
    const other = await groupWith("阿明");
    const res = await send(
      admin,
      "PATCH",
      `/groups/${group.id}/members/${other.group.me.memberId}`,
      {
        role: "admin",
      },
    );
    expect(res.status).toBe(404);
  });

  it("adds and patches a Member in a single ledger member() round-trip without listing all Members", async () => {
    const { admin, group } = await groupWith("小宇", "阿明");
    const realNamespace = env.GROUP_LEDGER;
    let membersRpcCalls = 0;
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
              if (prop === "members") {
                return (...args: unknown[]) => {
                  membersRpcCalls += 1;
                  return Reflect.apply(targetStub.members, targetStub, args);
                };
              }
              const value: unknown = Reflect.get(targetStub, prop, targetStub);
              return typeof value === "function"
                ? (...args: unknown[]): unknown => Reflect.apply(value, targetStub, args)
                : value;
            },
          });
        };
      },
    });

    const added = await call(
      `/groups/${group.id}/members`,
      {
        method: "POST",
        headers: { ...bearer(admin.accessToken), "Content-Type": "application/json" },
        body: JSON.stringify({ name: "成員1" }),
      },
      { GROUP_LEDGER: proxyNamespace },
    );
    expect(added.status).toBe(201);
    const placeholder = await added.json<{ id: string; displayName: string }>();
    expect(placeholder.displayName).toBe("成員1");

    const renamed = await call(
      `/groups/${group.id}/members/${placeholder.id}`,
      {
        method: "PATCH",
        headers: { ...bearer(admin.accessToken), "Content-Type": "application/json" },
        body: JSON.stringify({ placeholderName: "小華" }),
      },
      { GROUP_LEDGER: proxyNamespace },
    );
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({ id: placeholder.id, displayName: "小華" });
    expect(membersRpcCalls).toBe(0);
  });
});

describe("DELETE /groups/:id/members/:mid and POST /groups/:id/leave", () => {
  it("lets an Admin remove a Member at a zero Balance, who becomes a Former Member", async () => {
    const { admin, group, others } = await groupWith("小宇", "阿明");
    const ming = at(await listMembers(admin, group.id), 1);
    const res = await send(admin, "DELETE", `/groups/${group.id}/members/${ming.id}`);
    expect(res.status).toBe(204);
    const list = await listMembers(admin, group.id);
    expect(list[1]).toMatchObject({ id: ming.id, displayName: "阿明", status: "former" });
    expect((await send(at(others, 0), "GET", `/groups/${group.id}`)).status).toBe(404);
  });

  it("blocks removal while the Balance is not zero, saying how much", async () => {
    const { admin, group } = await groupWith("小宇", "阿明");
    const ming = at(await listMembers(admin, group.id), 1);
    await createExpense(
      admin,
      group.id,
      twdExpense(group.me.memberId, [group.me.memberId, ming.id], 400),
    );
    const res = await send(admin, "DELETE", `/groups/${group.id}/members/${ming.id}`);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: "BALANCE_NOT_ZERO", details: { balance: -200, currency: "TWD" } },
    });
  });

  it("forbids a plain Member from removing someone else", async () => {
    const { group, others } = await groupWith("小宇", "阿明");
    const res = await send(
      at(others, 0),
      "DELETE",
      `/groups/${group.id}/members/${group.me.memberId}`,
    );
    expect(res.status).toBe(403);
  });

  it("lets a Member leave at a zero Balance, and blocks it otherwise", async () => {
    const { admin, group, others } = await groupWith("小宇", "阿明", "小美");
    const list = await listMembers(admin, group.id);
    await createExpense(
      admin,
      group.id,
      twdExpense(at(list, 2).id, [at(list, 2).id, group.me.memberId], 300),
    );
    const blocked = await send(at(others, 1), "POST", `/groups/${group.id}/leave`);
    expect(await errorCode(blocked)).toBe("BALANCE_NOT_ZERO");

    const viaDelete = await send(
      at(others, 0),
      "DELETE",
      `/groups/${group.id}/members/${at(list, 1).id}`,
    );
    expect(viaDelete.status).toBe(204);
  });

  it("keeps the last Admin from leaving", async () => {
    const { admin, group } = await groupWith("小宇", "阿明");
    const res = await send(admin, "POST", `/groups/${group.id}/leave`);
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("LAST_ADMIN");
  });
});

describe("GET /groups/:id/members for someone the ledger no longer seats", () => {
  it("answers 404 with no roster or revision while a stale summary row remains", async () => {
    const { group, others } = await groupWith("小宇", "阿明");
    const ming = at(others, 0);
    expect((await send(ming, "POST", `/groups/${group.id}/leave`)).status).toBe(204);
    // The D1 copy lags behind the ledger: put Ming's old row back.
    await env.DB.prepare(
      "INSERT OR REPLACE INTO group_member_summary(user_id,group_id,member_id,role,net_balance,rev) VALUES (?,?,?,?,0,0)",
    )
      .bind(ming.userId, group.id, "stale-member-id", "member")
      .run();

    const res = await send(ming, "GET", `/groups/${group.id}/members`);

    expect(res.status).toBe(404);
    expect(res.headers.has("X-Group-Rev")).toBe(false);
  });
});
