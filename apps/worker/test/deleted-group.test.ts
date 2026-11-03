import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createExpense, postExpense, twdExpense } from "./expenses-harness.js";
import { at, groupWith, listMembers, send } from "./groups-harness.js";

describe("a deleted Group while the D1 copy of its members is stale", () => {
  it("answers 404 with no body and no revision on every read and write", async () => {
    const { admin, group, others } = await groupWith("小宇", "阿明");
    const ming = at(others, 0);
    const members = await listMembers(admin, group.id);
    const adminMember = at(members, 0);
    const mingMember = at(members, 1);
    const ids = [adminMember.id, mingMember.id];
    const expense = await createExpense(admin, group.id, twdExpense(adminMember.id, ids));
    expect((await send(admin, "DELETE", `/groups/${group.id}`)).status).toBe(204);
    // The projection into D1 lags: put both Members' summary rows back.
    for (const [session, member, role] of [
      [admin, adminMember, "admin"],
      [ming, mingMember, "member"],
    ] as const) {
      await env.DB.prepare(
        "INSERT OR REPLACE INTO group_member_summary(user_id,group_id,member_id,role,net_balance,rev) VALUES (?,?,?,?,0,0)",
      )
        .bind(session.userId, group.id, member.id, role)
        .run();
    }

    for (const session of [admin, ming]) {
      for (const path of [
        `/groups/${group.id}`,
        `/groups/${group.id}/members`,
        `/groups/${group.id}/expenses`,
        `/groups/${group.id}/expenses/${expense.id}`,
        `/groups/${group.id}/balances`,
        `/groups/${group.id}/settlements`,
        `/groups/${group.id}/stops`,
      ]) {
        const res = await send(session, "GET", path);
        expect(res.status, path).toBe(404);
        expect(res.headers.has("X-Group-Rev"), path).toBe(false);
      }
    }
    const write = await postExpense(admin, group.id, twdExpense(adminMember.id, ids));
    expect(write.status).toBe(404);
  });
});
