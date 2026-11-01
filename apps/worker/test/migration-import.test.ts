import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db/client.js";
import { groups, members } from "../src/db/schema.js";
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
    expect((await call(`/maintenance/migration/import/${group.id}`)).status).toBe(404);
    expect(
      (await call(`/maintenance/migration/import/wrong-id`, { method: "POST", headers }, bindings))
        .status,
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
    const groupData = await getGroup.json<{
      name: string;
      isTrip: boolean;
      tripDestination: string;
    }>();
    expect(groupData.name).toBe("明天去哪玩");
    expect(groupData.isTrip).toBe(true);
    expect(groupData.tripDestination).toBe("花蓮");

    const getMembers = await listMembers(admin, group.id);
    expect(getMembers.length).toBe(3);
    expect(getMembers.some((m) => m.displayName === "小草" && m.status === "placeholder")).toBe(
      true,
    );
    expect(getMembers.some((m) => m.userId === member.userId)).toBe(true);

    const getBalances = await send(admin, "GET", `/groups/${group.id}/balances`);
    expect(getBalances.status).toBe(200);
    const balances = await getBalances.json<{ balances: Array<{ balance: number }> }>();
    const sum = balances.balances.reduce((acc, b) => acc + b.balance, 0);
    expect(sum).toBe(0);

    const getExpenses = await send(admin, "GET", `/groups/${group.id}/expenses`);
    expect(getExpenses.status).toBe(200);
    const resBody = await getExpenses.json<
      { expenses?: Array<{ description: string }> } | Array<{ description: string }>
    >();
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

    // Create an excluded group to verify controlled wipe
    const otherPerson = await person("mig-other");
    const otherGroup = await createGroup(otherPerson, { name: "週末聚餐" });
    expect((await send(otherPerson, "GET", `/groups/${otherGroup.id}`)).status).toBe(200);

    // Wipe excluded groups without bypass header is blocked
    expect(
      (await call(`/maintenance/migration/wipe-excluded/${group.id}`, { method: "POST" })).status,
    ).toBe(404);

    // Wipe excluded groups with wrong retained id is rejected (409 EDIT_CONFLICT)
    expect(
      (
        await call(
          `/maintenance/migration/wipe-excluded/${otherGroup.id}`,
          { method: "POST", headers },
          bindings,
        )
      ).status,
    ).toBe(409);

    // A failed ledger deletion must remain discoverable after the D1 wipe.
    const failingNamespace = new Proxy(env.GROUP_LEDGER, {
      get(target, key) {
        if (key !== "get") {
          const value: unknown = Reflect.get(target, key, target);
          return typeof value === "function"
            ? (...args: unknown[]): unknown => Reflect.apply(value, target, args)
            : value;
        }
        return (id: Parameters<typeof target.get>[0]) => {
          const stub = target.get(id);
          return new Proxy(stub, {
            get(inner, property) {
              if (property !== "fetch") {
                const value: unknown = Reflect.get(inner, property, inner);
                return typeof value === "function"
                  ? (...args: unknown[]): unknown => Reflect.apply(value, inner, args)
                  : value;
              }
              return (input: RequestInfo | URL, init?: RequestInit) => {
                const url =
                  typeof input === "string"
                    ? input
                    : input instanceof URL
                      ? input.toString()
                      : input.url;
                if (url.endsWith("/delete"))
                  return Promise.resolve(new Response(null, { status: 503 }));
                return inner.fetch(input, init);
              };
            },
          });
        };
      },
    });
    const failedWipe = await call(
      `/maintenance/migration/wipe-excluded/${group.id}`,
      { method: "POST", headers },
      { ...bindings, GROUP_LEDGER: failingNamespace },
    );
    expect(failedWipe.status).toBe(500);
    const failure = await failedWipe.json<{ error: { details: { failedLedgers: string[] } } }>();
    expect(failure.error.details.failedLedgers).toContain(otherGroup.id);

    // Execute wipe-excluded with verified retained group id
    const wipeRes = await call(
      `/maintenance/migration/wipe-excluded/${group.id}`,
      { method: "POST", headers },
      bindings,
    );
    expect(wipeRes.status).toBe(200);
    const wipeResult = await wipeRes.json<{
      ok: boolean;
      retainedGroupId: string;
      wiped: boolean;
    }>();
    expect(wipeResult.ok).toBe(true);
    expect(wipeResult.retainedGroupId).toBe(group.id);

    // Idempotent re-run succeeds
    expect(
      (
        await call(
          `/maintenance/migration/wipe-excluded/${group.id}`,
          { method: "POST", headers },
          bindings,
        )
      ).status,
    ).toBe(200);

    // Excluded group is gone (404)
    expect((await send(otherPerson, "GET", `/groups/${otherGroup.id}`)).status).toBe(404);

    // Retained group is still intact and accessible
    expect((await send(admin, "GET", `/groups/${group.id}`)).status).toBe(200);

    // User accounts, identities, and sessions are preserved
    expect((await send(admin, "GET", "/me")).status).toBe(200);
    expect((await send(otherPerson, "GET", "/me")).status).toBe(200);
  });

  it("imports legacy D1 expenses with amount, share_units, and split_type into a fresh ledger DO", async () => {
    const admin = await person("Legacy Import Admin");
    const groupId = crypto.randomUUID();
    const adminMemberId = crypto.randomUUID();
    const placeholderId = crypto.randomUUID();
    const now = Date.now();

    const db = createDb(env.DB);
    await db.insert(groups).values({
      id: groupId,
      name: "明天去哪玩",
      settlementCurrency: "TWD",
      defaultExpenseCurrency: "TWD",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(members).values([
      {
        id: adminMemberId,
        groupId,
        userId: admin.userId,
        role: "admin",
        status: "active",
        createdAt: now,
      },
      {
        id: placeholderId,
        groupId,
        userId: null,
        placeholderName: "室友",
        role: "member",
        status: "placeholder",
        createdAt: now,
      },
    ]);

    // Directly invoke DO /import on a fresh uninitialized ledger DO
    const legacySnapshot = {
      group: {
        id: groupId,
        name: "明天去哪玩",
        settlement_currency: "TWD",
        default_expense_currency: "TWD",
        created_at: now,
        updated_at: now,
      },
      members: [
        {
          id: adminMemberId,
          group_id: groupId,
          user_id: admin.userId,
          role: "admin",
          status: "active",
          created_at: now,
        },
        {
          id: placeholderId,
          group_id: groupId,
          user_id: null,
          placeholder_name: "室友",
          role: "member",
          status: "placeholder",
          created_at: now,
        },
      ],
      invites: [],
      expenses: [
        {
          id: "exp-legacy-1",
          idempotency_key: `${adminMemberId}:legacy-key`,
          group_id: groupId,
          creator_member_id: adminMemberId,
          description: "舊版晚餐",
          category: "food",
          original_amount: 500,
          original_currency: "TWD",
          fx_rate_scaled: 10000,
          fx_date: "2026-07-01",
          is_custom_rate: false,
          settlement_amount: 500,
          split_type: "equal",
          expense_date: "2026-07-01",
          created_at: now,
          updated_at: now,
        },
        {
          id: "exp-legacy-2",
          group_id: groupId,
          creator_member_id: adminMemberId,
          description: "舊版租車",
          category: "transport",
          original_amount: 600,
          original_currency: "TWD",
          fx_rate_scaled: 10000,
          fx_date: "2026-07-01",
          is_custom_rate: false,
          settlement_amount: 600,
          split_type: "shares",
          expense_date: "2026-07-01",
          created_at: now,
          updated_at: now,
        },
      ],
      payers: [
        {
          id: "p-1",
          expense_id: "exp-legacy-1",
          member_id: adminMemberId,
          amount: 500,
          settlement_amount: 500,
        },
        {
          id: "p-2",
          expense_id: "exp-legacy-2",
          member_id: adminMemberId,
          amount: 600,
          settlement_amount: 600,
        },
      ],
      splits: [
        {
          id: "s-1",
          expense_id: "exp-legacy-1",
          member_id: adminMemberId,
          amount: 250,
          settlement_amount: 250,
          share_units: 1,
        },
        {
          id: "s-2",
          expense_id: "exp-legacy-1",
          member_id: placeholderId,
          amount: 250,
          settlement_amount: 250,
          share_units: 1,
        },
        {
          id: "s-3",
          expense_id: "exp-legacy-2",
          member_id: adminMemberId,
          amount: 400,
          settlement_amount: 400,
          share_units: 2,
        },
        {
          id: "s-4",
          expense_id: "exp-legacy-2",
          member_id: placeholderId,
          amount: 200,
          settlement_amount: 200,
          share_units: 1,
        },
      ],
      settlements: [
        {
          id: "stl-legacy-1",
          group_id: groupId,
          payer_member_id: placeholderId,
          receiver_member_id: adminMemberId,
          amount: 150,
          currency: "TWD",
          status: "confirmed",
          note: "部分還款",
          // Legacy stored `${creator}:${key}`, which is the ledger's own settlement key format, so
          // the import must keep it verbatim for a retried request to find the original.
          idempotency_key: `${adminMemberId}:legacy-settle-key`,
          created_by_member_id: null,
          confirmed_by_member_id: adminMemberId,
          confirmed_at: now,
          undone_by_member_id: null,
          undone_at: null,
          created_at: now,
          updated_at: now,
        },
      ],
      stops: [],
    };

    const res = await env.GROUP_LEDGER.get(env.GROUP_LEDGER.idFromName(groupId)).fetch(
      "https://ledger.internal/import",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot: legacySnapshot, now }),
      },
    );
    expect(res.status).toBe(200);

    // Verify reading expenses from imported group
    const listRes = await send(admin, "GET", `/groups/${groupId}/expenses`);
    expect(listRes.status).toBe(200);
    const page = await listRes.json<{
      expenses: Array<{ id: string; description: string; splitMethod: string }>;
    }>();
    expect(page.expenses).toHaveLength(2);
    expect(page.expenses.find((e) => e.id === "exp-legacy-1")?.splitMethod).toBe("equal");
    expect(page.expenses.find((e) => e.id === "exp-legacy-2")?.splitMethod).toBe("shares");

    const retry = await send(
      admin,
      "POST",
      `/groups/${groupId}/expenses`,
      twdExpense(adminMemberId, [adminMemberId], 500),
      { "Idempotency-Key": "legacy-key" },
    );
    expect(retry.status).toBe(201);
    expect((await retry.json<{ id: string }>()).id).toBe("exp-legacy-1");

    const settleRetry = await send(
      admin,
      "POST",
      `/groups/${groupId}/settlements`,
      { payerMemberId: placeholderId, receiverMemberId: adminMemberId, amount: 150 },
      { "Idempotency-Key": "legacy-settle-key" },
    );
    expect(settleRetry.status).toBe(201);
    expect((await settleRetry.json<{ id: string }>()).id).toBe("stl-legacy-1");

    // Verify balances calculated from legacy expenses and confirmed settlements
    const balRes = await send(admin, "GET", `/groups/${groupId}/balances`);
    expect(balRes.status).toBe(200);
    const balances = await balRes.json<{
      balances: Array<{ memberId: string; balance: number }>;
    }>();
    const adminBal = balances.balances.find((b) => b.memberId === adminMemberId);
    const placeBal = balances.balances.find((b) => b.memberId === placeholderId);
    expect(adminBal?.balance).toBe(300);
    expect(placeBal?.balance).toBe(-300);
  });
});
