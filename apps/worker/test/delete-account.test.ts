import { describe, expect, it } from "vitest";
import { bearer, call, json, signIn, uniqueSub, withCookie } from "./auth-harness.js";
import { createGroup, groupWith, listMembers, person, send } from "./groups-harness.js";
import { createExpense, twdExpense } from "./expenses-harness.js";

function deleteMe(accessToken: string) {
  return call("/me", { method: "DELETE", headers: bearer(accessToken) });
}

describe("DELETE /me", () => {
  it("keeps the deleted User's Expense history as a Former Member", async () => {
    const { admin, group, others } = await groupWith("admin", "departing");
    const departing = others[0];
    if (departing === undefined) throw new Error("missing member");
    const member = (await listMembers(admin, group.id)).find((m) => m.userId === departing.userId);
    if (member === undefined) throw new Error("missing member");
    const expense = await createExpense(departing, group.id, twdExpense(member.id, [member.id]));
    const result = await deleteMe(departing.accessToken);
    expect(result.status).toBe(204);
    expect(result.headers.get("Set-Cookie")).toMatch(/refresh=;/);
    expect(await listMembers(admin, group.id)).toContainEqual(
      expect.objectContaining({
        id: member.id,
        userId: null,
        status: "former",
        displayName: "已刪除的使用者",
      }),
    );
    expect((await send(admin, "GET", `/groups/${group.id}/expenses/${expense.id}`)).status).toBe(
      200,
    );
    expect((await call("/me", { headers: bearer(departing.accessToken) })).status).toBe(401);
    expect((await call("/auth/refresh", withCookie(departing.refresh))).status).toBe(401);
  });

  it("refuses a User with a nonzero Balance", async () => {
    const { admin, group, others } = await groupWith("payer", "debtor");
    const debtor = others[0];
    if (debtor === undefined) throw new Error("missing member");
    const people = await listMembers(admin, group.id);
    const payerId = people.find((m) => m.userId === admin.userId)?.id;
    const debtorId = people.find((m) => m.userId === debtor.userId)?.id;
    if (payerId === undefined || debtorId === undefined) throw new Error("missing member");
    await createExpense(admin, group.id, twdExpense(payerId, [payerId, debtorId]));
    const result = await deleteMe(debtor.accessToken);
    expect(result.status).toBe(409);
    expect(await result.json()).toEqual({
      error: { code: "BALANCE_NOT_ZERO", details: { groupIds: [group.id] } },
    });
  });

  it("refuses the last Admin of a Group with other active Members", async () => {
    const { admin, group } = await groupWith("admin", "member");
    const result = await deleteMe(admin.accessToken);
    expect(result.status).toBe(409);
    expect(await result.json()).toEqual({
      error: { code: "LAST_ADMIN", details: { groupIds: [group.id] } },
    });
    expect(
      (await send(admin, "POST", `/groups/${group.id}/members`, { name: "new seat" })).status,
    ).toBe(201);
  });

  it("deletes a sole Member's Group", async () => {
    const user = await person("solo");
    const group = await createGroup(user);
    expect((await deleteMe(user.accessToken)).status).toBe(204);
    const other = await person("outsider");
    expect((await send(other, "GET", `/groups/${group.id}`)).status).toBe(404);
  });

  it("lets the same provider account sign up again as a new User", async () => {
    const sub = uniqueSub("again");
    const first = await signIn("google", sub);
    expect((await deleteMe(first.accessToken)).status).toBe(204);
    const res = await call("/auth/google", json({ idToken: `fake|${sub}|小宇` }));
    const body = await res.json<{ user: { id: string } }>();
    expect(body.user.id).not.toBe(first.userId);
  });
});

it("shows a deleted User as a Former Member in their Group", async () => {
  const { groupWith, listMembers, send } = await import("./groups-harness.js");
  const { admin, group, others } = await groupWith("admin", "departing");
  const departing = others[0];
  if (departing === undefined) throw new Error("missing member");
  expect((await deleteMe(departing.accessToken)).status).toBe(204);
  expect(await listMembers(admin, group.id)).toContainEqual(
    expect.objectContaining({
      userId: null,
      status: "former",
      displayName: "已刪除的使用者",
    }),
  );
  const updated = await (
    await send(admin, "GET", `/groups/${group.id}`)
  ).json<{ memberCount: number }>();
  expect(updated.memberCount).toBe(1);
});

it("checks the ledger Balance when the Group summary is stale and unfreezes on refusal", async () => {
  const { groupWith, listMembers, send, person } = await import("./groups-harness.js");
  const { createExpense, twdExpense } = await import("./expenses-harness.js");
  const { failDirectoryWrites } = await import("./d1-faults.js");
  const { admin, group, token, others } = await groupWith("payer", "debtor");
  const debtor = others[0];
  if (debtor === undefined) throw new Error("missing member");
  const people = await listMembers(admin, group.id);
  const payerId = people.find((m) => m.userId === admin.userId)?.id;
  const debtorId = people.find((m) => m.userId === debtor.userId)?.id;
  if (payerId === undefined || debtorId === undefined) throw new Error("missing ids");
  const restore = await failDirectoryWrites();
  try {
    await createExpense(admin, group.id, twdExpense(payerId, [payerId, debtorId]));
    const response = await deleteMe(debtor.accessToken);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "BALANCE_NOT_ZERO", details: { groupIds: [group.id] } },
    });
  } finally {
    await restore();
  }
  const other = await person("another member");
  expect((await send(other, "POST", `/invites/${token}/join`)).status).toBe(200);
});

it("never leaves an active Member when a join races account deletion", async () => {
  const { admin, group, token } = await groupWith("race admin");
  const joining = await person("racing user");
  const [join, deletion] = await Promise.all([
    send(joining, "POST", `/invites/${token}/join`),
    deleteMe(joining.accessToken),
  ]);
  expect(deletion.status).toBe(204);
  expect([200, 401, 403, 404]).toContain(join.status);
  expect(
    (await listMembers(admin, group.id)).some(
      (member) => member.userId === joining.userId && member.status === "active",
    ),
  ).toBe(false);
});
