import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db/client.js";
import { members } from "../src/db/schema.js";
import { at, errorCode, groupWith, listMembers, person, send } from "./groups-harness.js";

const db = createDb(env.DB);

async function setBalance(memberId: string, balance: number) {
  await db.update(members).set({ netBalance: balance }).where(eq(members.id, memberId));
}

describe("a Former Member's name", () => {
  it("never revives a nickname they once chose, but keeps the system label", async () => {
    const { admin, group, others } = await groupWith("小宇", "阿明");
    const ming = at(await listMembers(admin, group.id), 1);

    // A nickname chosen while active is ignored, and stays ignored after they leave.
    await db
      .update(members)
      .set({ nickname: "Ali", status: "former" })
      .where(eq(members.id, ming.id));
    expect(at(await listMembers(admin, group.id), 1)).toMatchObject({
      displayName: "阿明",
      status: "former",
    });

    // The label written when an account is deleted is still what shows.
    await db
      .update(members)
      .set({ nickname: "已刪除的使用者", userId: null })
      .where(eq(members.id, ming.id));
    expect(at(await listMembers(admin, group.id), 1)).toMatchObject({
      displayName: "已刪除的使用者",
    });
    expect(others).toHaveLength(1);
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
    await setBalance(ming.id, -200);
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
    await setBalance(at(list, 2).id, 150);
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
