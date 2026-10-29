import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db/client.js";
import { expensePayers, members } from "../src/db/schema.js";
import {
  at,
  errorCode,
  groupWith,
  listMembers,
  type MemberBody,
  person,
  seedExpense,
  send,
} from "./groups-harness.js";

const db = createDb(env.DB);

async function addPlaceholder(
  s: Parameters<typeof send>[0],
  groupId: string,
  name: string,
): Promise<MemberBody> {
  const res = await send(s, "POST", `/groups/${groupId}/members`, { name });
  if (res.status !== 201) throw new Error(`add placeholder: ${res.status} ${await res.text()}`);
  return res.json<MemberBody>();
}

describe("POST /groups/:id/members (Placeholder Members)", () => {
  it("lets any Member add a Placeholder by name, with no account or picture", async () => {
    const { group, others } = await groupWith("小宇", "阿明");
    const kai = await addPlaceholder(at(others, 0), group.id, "阿凱");
    expect(kai).toMatchObject({
      userId: null,
      displayName: "阿凱",
      pictureUrl: null,
      role: "member",
      status: "placeholder",
      balance: 0,
      isMe: false,
    });
    const groupRes = await send(at(others, 0), "GET", `/groups/${group.id}`);
    expect((await groupRes.json<{ memberCount: number }>()).memberCount).toBe(3);
  });

  it("refuses a name already used in the Group", async () => {
    const { admin, group } = await groupWith("小宇", "阿明");
    await addPlaceholder(admin, group.id, "阿凱");
    for (const name of ["阿凱", "阿明"]) {
      const res = await send(admin, "POST", `/groups/${group.id}/members`, { name });
      expect(res.status).toBe(409);
      expect(await errorCode(res)).toBe("PLACEHOLDER_NAME_TAKEN");
    }
  });

  it("counts toward the 30-Member cap", async () => {
    const { admin, group } = await groupWith("小宇");
    for (let i = 1; i < 30; i += 1) await addPlaceholder(admin, group.id, `朋友${String(i)}`);
    const res = await send(admin, "POST", `/groups/${group.id}/members`, { name: "第31人" });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("GROUP_FULL");
  });

  it("answers 404 to a non-member", async () => {
    const { group } = await groupWith("小宇");
    const stranger = await person("路人");
    const res = await send(stranger, "POST", `/groups/${group.id}/members`, { name: "阿凱" });
    expect(res.status).toBe(404);
  });
});

describe("POST /invites/:token/claim", () => {
  it("moves a Placeholder's Expenses and Balance to the joining User", async () => {
    const { admin, group, token } = await groupWith("小宇");
    const kai = await addPlaceholder(admin, group.id, "阿凱");
    const expenseId = await seedExpense(group.id, kai.id, [kai.id, group.me.memberId]);
    await seedExpense(group.id, group.me.memberId, [kai.id, group.me.memberId]);
    await db.update(members).set({ netBalance: -200 }).where(eq(members.id, kai.id));

    const realKai = await person("凱凱");
    const preview = await send(realKai, "GET", `/invites/${token}`);
    expect((await preview.json<{ placeholders: unknown[] }>()).placeholders).toEqual([
      { memberId: kai.id, name: "阿凱", addedBy: "小宇", balance: -200, expenseCount: 2 },
    ]);

    const res = await send(realKai, "POST", `/invites/${token}/claim`, { memberId: kai.id });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ groupId: group.id, memberId: kai.id });

    const list = await listMembers(realKai, group.id);
    expect(list.find((m) => m.id === kai.id)).toMatchObject({
      userId: realKai.userId,
      displayName: "凱凱",
      status: "active",
      balance: -200,
      isMe: true,
    });
    const [payer] = await db
      .select()
      .from(expensePayers)
      .where(eq(expensePayers.expenseId, expenseId));
    expect(payer?.memberId).toBe(kai.id);
    const after = await send(realKai, "GET", `/invites/${token}`);
    expect((await after.json<{ placeholders: unknown[] }>()).placeholders).toEqual([]);
  });

  it("refuses a Placeholder someone already claimed", async () => {
    const { admin, group, token } = await groupWith("小宇");
    const kai = await addPlaceholder(admin, group.id, "阿凱");
    const first = await person("凱凱");
    expect(
      (await send(first, "POST", `/invites/${token}/claim`, { memberId: kai.id })).status,
    ).toBe(200);
    const second = await person("冒牌");
    const res = await send(second, "POST", `/invites/${token}/claim`, { memberId: kai.id });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("PLACEHOLDER_CLAIMED");
  });

  it("refuses an existing Member and a Placeholder from another Group", async () => {
    const { admin, group, token, others } = await groupWith("小宇", "阿明");
    const kai = await addPlaceholder(admin, group.id, "阿凱");
    const asMember = await send(at(others, 0), "POST", `/invites/${token}/claim`, {
      memberId: kai.id,
    });
    expect(await errorCode(asMember)).toBe("ALREADY_MEMBER");

    const other = await groupWith("小美");
    const foreign = await addPlaceholder(other.admin, other.group.id, "阿凱");
    const res = await send(await person("凱凱"), "POST", `/invites/${token}/claim`, {
      memberId: foreign.id,
    });
    expect(res.status).toBe(404);
  });
});

describe("removing a Placeholder Member", () => {
  it("is Admin only and deletes the typed name", async () => {
    const { admin, group, others } = await groupWith("小宇", "阿明");
    const kai = await addPlaceholder(at(others, 0), group.id, "阿凱");
    expect(
      (await send(at(others, 0), "DELETE", `/groups/${group.id}/members/${kai.id}`)).status,
    ).toBe(403);
    expect((await send(admin, "DELETE", `/groups/${group.id}/members/${kai.id}`)).status).toBe(204);
    expect(await db.select().from(members).where(eq(members.id, kai.id))).toEqual([]);
  });

  it("keeps a generic Former Member row when old Expenses still name the Placeholder", async () => {
    const { admin, group } = await groupWith("小宇");
    const kai = await addPlaceholder(admin, group.id, "阿凱");
    await seedExpense(group.id, kai.id);
    expect((await send(admin, "DELETE", `/groups/${group.id}/members/${kai.id}`)).status).toBe(204);
    const [row] = await db.select().from(members).where(eq(members.id, kai.id));
    expect(row).toMatchObject({
      status: "former",
      placeholderName: null,
      nickname: "已移除的成員",
    });
  });

  it("is blocked at a non-zero Balance", async () => {
    const { admin, group } = await groupWith("小宇");
    const kai = await addPlaceholder(admin, group.id, "阿凱");
    await db.update(members).set({ netBalance: 300 }).where(eq(members.id, kai.id));
    const res = await send(admin, "DELETE", `/groups/${group.id}/members/${kai.id}`);
    expect(await errorCode(res)).toBe("BALANCE_NOT_ZERO");
  });
});
