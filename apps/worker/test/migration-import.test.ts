import { describe, expect, it } from "vitest";
import { call } from "./auth-harness.js";
import { createExpense, twdExpense } from "./expenses-harness.js";
import { createGroup, listMembers, person, send } from "./groups-harness.js";

describe("retained Group migration import", () => {
  it("imports the verified Group into its ledger idempotently and verifies all records", async () => {
    const admin = await person("mig-admin");
    const member = await person("mig-member");
    const group = await createGroup(admin, {
      name: "明天去哪玩",
      isTrip: true,
      tripDestination: "花蓮",
      tripStartDate: "2026-07-01",
      tripEndDate: "2026-07-05",
      tripNotes: "七星潭",
    });

    // Invite member
    const inviteRes = await send(admin, "POST", `/groups/${group.id}/invite`);
    const token = (await inviteRes.json<{ token: string }>()).token;
    expect((await send(member, "POST", `/invites/${token}/join`)).status).toBe(200);

    // Add placeholder member
    const phRes = await send(admin, "POST", `/groups/${group.id}/members`, {
      name: "小草",
    });
    expect(phRes.status).toBe(201);

    // Add trip stop
    const stopRes = await send(admin, "POST", `/groups/${group.id}/stops`, {
      dayDate: "2026-07-01",
      startTime: "10:00",
      title: "出發集合",
      category: "景點",
    });
    expect(stopRes.status).toBe(201);

    // Record expense
    const membersBefore = await listMembers(admin, group.id);
    const adminMember = membersBefore.find((m) => m.userId === admin.userId);
    const plainMember = membersBefore.find((m) => m.userId === member.userId);
    expect(adminMember).toBeDefined();
    expect(plainMember).toBeDefined();
    if (!adminMember || !plainMember) throw new Error("Members not found");

    await createExpense(
      admin,
      group.id,
      twdExpense(adminMember.id, [adminMember.id, plainMember.id], 1000, {
        description: "高鐵票",
        category: "food",
        expenseDate: "2026-07-01",
      }),
    );

    // Record settlement
    const settleRes = await send(
      member,
      "POST",
      `/groups/${group.id}/settlements`,
      {
        payerMemberId: plainMember.id,
        receiverMemberId: adminMember.id,
        amount: 200,
      },
      { "Idempotency-Key": "mig-set-1" },
    );
    expect(settleRes.status).toBe(201);

    const headers = { "X-Maintenance-Bypass": "mig-secret" };
    const bindings = { MAINTENANCE: "mig-secret" };

    // Snapshot
    const snapRes = await call(
      `/maintenance/migration/snapshot/${group.id}`,
      { headers },
      bindings,
    );
    expect(snapRes.status).toBe(200);
    const snapshot = await snapRes.json<{ fingerprint: string }>();
    expect(snapshot.fingerprint).toMatch(/^[a-f0-9]{64}$/);

    // Error checks on import
    expect(
      (await call(`/maintenance/migration/import/${group.id}`)).status,
    ).toBe(404);
    expect(
      (
        await call(
          `/maintenance/migration/import/wrong-id`,
          { method: "POST", headers },
          bindings,
        )
      ).status,
    ).toBe(409);

    // Execute import
    const importRes = await call(
      `/maintenance/migration/import/${group.id}`,
      { method: "POST", headers },
      bindings,
    );
    expect(importRes.status).toBe(200);
    const importResult = await importRes.json<{
      ok: boolean;
      groupId: string;
      membersCount: number;
      expensesCount: number;
      fingerprint: string;
    }>();
    expect(importResult.ok).toBe(true);
    expect(importResult.groupId).toBe(group.id);
    expect(importResult.fingerprint).toBe(snapshot.fingerprint);

    // Idempotency: re-running import succeeds cleanly
    const reimportRes = await call(
      `/maintenance/migration/import/${group.id}`,
      { method: "POST", headers },
      bindings,
    );
    expect(reimportRes.status).toBe(200);

    // Verify all reads from imported Group
    const getGroup = await send(admin, "GET", `/groups/${group.id}`);
    expect(getGroup.status).toBe(200);
    const groupData = await getGroup.json<{ name: string; isTrip: boolean; tripDestination: string }>();
    expect(groupData.name).toBe("明天去哪玩");
    expect(groupData.isTrip).toBe(true);
    expect(groupData.tripDestination).toBe("花蓮");

    const getMembers = await listMembers(admin, group.id);
    expect(getMembers.length).toBe(3);
    expect(getMembers.some((m) => m.displayName === "小草" && m.status === "placeholder")).toBe(true);
    expect(getMembers.some((m) => m.userId === member.userId)).toBe(true);

    const getBalances = await send(admin, "GET", `/groups/${group.id}/balances`);
    expect(getBalances.status).toBe(200);
    const balances = await getBalances.json<{ balances: Array<{ balance: number }> }>();
    const sum = balances.balances.reduce((acc, b) => acc + b.balance, 0);
    expect(sum).toBe(0);

    const getExpenses = await send(admin, "GET", `/groups/${group.id}/expenses`);
    expect(getExpenses.status).toBe(200);
    const resBody = await getExpenses.json<{ expenses?: Array<{ description: string }> } | Array<{ description: string }>>();
    const expensesList = Array.isArray(resBody) ? resBody : (resBody.expenses ?? []);
    expect(expensesList.some((e) => e.description === "高鐵票")).toBe(true);

    const getSettlements = await send(admin, "GET", `/groups/${group.id}/settlements`);
    expect(getSettlements.status).toBe(200);
    const settlementsList = await getSettlements.json<{ settlements: Array<{ amount: number }> }>();
    expect(settlementsList.settlements.some((s) => s.amount === 200)).toBe(true);

    const getStops = await send(admin, "GET", `/groups/${group.id}/stops`);
    expect(getStops.status).toBe(200);
    const stopsList = await getStops.json<Array<{ title: string }>>();
    expect(stopsList.some((s) => s.title === "出發集合")).toBe(true);

    const listGroups = await send(admin, "GET", "/groups");
    expect(listGroups.status).toBe(200);
    const groupsList = await listGroups.json<Array<{ id: string; name: string }>>();
    expect(groupsList.some((g) => g.id === group.id)).toBe(true);
  });
});
