import type { Settlement, SettlementPage } from "@split/shared";
import { describe, expect, it } from "vitest";
import type { Session } from "./auth-harness.js";
import { balances, createExpense, newKey, twdExpense } from "./expenses-harness.js";
import { errorCode, groupWith, listMembers, send } from "./groups-harness.js";

function postSettlement(
  session: Session,
  groupId: string,
  body: unknown,
  key: string = newKey(),
): Promise<Response> {
  return send(session, "POST", `/groups/${groupId}/settlements`, body, { "Idempotency-Key": key });
}

async function record(session: Session, groupId: string, body: unknown): Promise<Settlement> {
  const res = await postSettlement(session, groupId, body);
  if (res.status !== 201) throw new Error(`settlement: ${res.status} ${await res.text()}`);
  return res.json<Settlement>();
}

/**
 * 小宇 (Admin) and 阿明 and 小美 (Members). 小宇 paid NT$900 split three ways, so 阿明 and
 * 小美 each owe 300 and 小宇 is owed 600.
 */
async function owingGroup() {
  const { admin, group, others } = await groupWith("小宇", "阿明", "小美");
  const [ming, mei] = others;
  const [a, b, c] = (await listMembers(admin, group.id)).map((m) => m.id);
  if (ming === undefined || mei === undefined) throw new Error("sessions");
  if (a === undefined || b === undefined || c === undefined) throw new Error("members");
  await createExpense(admin, group.id, twdExpense(a, [a, b, c], 900));
  return { group, admin, ming, mei, ids: { admin: a, ming: b, mei: c } };
}

describe("Settlements", () => {
  it("a payer's Settlement is confirmed at once and moves Balances immediately", async () => {
    const { group, admin, ming, ids } = await owingGroup();

    const confirmed = await record(ming, group.id, {
      payerMemberId: ids.ming,
      receiverMemberId: ids.admin,
      amount: 300,
    });
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.confirmedByMemberId).toBe(ids.ming);
    expect(Object.fromEntries(await balances(admin, group.id))).toEqual({
      [ids.admin]: 300,
      [ids.ming]: 0,
      [ids.mei]: -300,
    });
  });

  it("a payment the receiver records is confirmed at once and can be partial", async () => {
    const { group, admin, ids } = await owingGroup();

    const settled = await record(admin, group.id, {
      payerMemberId: ids.mei,
      receiverMemberId: ids.admin,
      amount: 120,
    });

    expect(settled.status).toBe("confirmed");
    expect(Object.fromEntries(await balances(admin, group.id))).toEqual({
      [ids.admin]: 480,
      [ids.ming]: -300,
      [ids.mei]: -180,
    });
  });

  it("refuses a payment beyond what the payer still owes that receiver", async () => {
    const { group, admin, ming, ids } = await owingGroup();

    const over = await postSettlement(admin, group.id, {
      payerMemberId: ids.ming,
      receiverMemberId: ids.admin,
      amount: 301,
    });
    expect(over.status).toBe(422);
    expect(await over.json()).toEqual({
      error: { code: "SETTLEMENT_EXCEEDS_DEBT", details: { maxAmount: 300 } },
    });

    // 阿明 is owed nothing, so nobody can pay him.
    const wrongWay = await postSettlement(ming, group.id, {
      payerMemberId: ids.mei,
      receiverMemberId: ids.ming,
      amount: 1,
    });
    expect(await errorCode(wrongWay)).toBe("SETTLEMENT_EXCEEDS_DEBT");
    expect((await balances(admin, group.id)).get(ids.ming)).toBe(-300);
  });

  it("undoing a confirmed Settlement restores Balances and keeps it in the history as undone", async () => {
    const { group, admin, ming, mei, ids } = await owingGroup();
    const settled = await record(ming, group.id, {
      payerMemberId: ids.ming,
      receiverMemberId: ids.admin,
      amount: 300,
    });

    expect((await send(mei, "POST", `/settlements/${settled.id}/undo`)).status).toBe(403);
    const res = await send(admin, "POST", `/settlements/${settled.id}/undo`);
    expect(res.status).toBe(200);
    const undone = await res.json<Settlement>();
    expect(undone.status).toBe("undone");
    expect(undone.undoneByMemberId).toBe(ids.admin);
    expect(Object.fromEntries(await balances(admin, group.id))).toEqual({
      [ids.admin]: 600,
      [ids.ming]: -300,
      [ids.mei]: -300,
    });

    const again = await send(admin, "POST", `/settlements/${settled.id}/undo`);
    expect(await errorCode(again)).toBe("SETTLEMENT_NOT_CONFIRMED");
    expect((await balances(admin, group.id)).get(ids.ming)).toBe(-300);

    const list = await send(mei, "GET", `/groups/${group.id}/settlements`);
    const page = await list.json<SettlementPage>();
    expect(page.settlements.map((s) => [s.id, s.status])).toEqual([[settled.id, "undone"]]);
    expect(page.nextCursor).toBeNull();
  });

  it("the payer, the receiver, or an Admin can undo a confirmed Settlement", async () => {
    const { admin, group, others } = await groupWith("小宇", "阿明", "小美");
    const [ming, mei] = others;
    const [a, b, c] = (await listMembers(admin, group.id)).map((m) => m.id);
    if (ming === undefined || mei === undefined || a === undefined) throw new Error("sessions");
    if (b === undefined || c === undefined) throw new Error("members");
    // 阿明 paid NT$400 for 阿明 and 小美: 小美 owes 阿明 200.
    await createExpense(ming, group.id, twdExpense(b, [b, c], 400));

    const byReceiver = await record(ming, group.id, {
      payerMemberId: c,
      receiverMemberId: b,
      amount: 50,
    });
    // Payer (mei) can undo receiver's confirm
    expect((await send(mei, "POST", `/settlements/${byReceiver.id}/undo`)).status).toBe(200);

    const byAdmin = await record(admin, group.id, {
      payerMemberId: c,
      receiverMemberId: b,
      amount: 50,
    });
    expect(byAdmin.status).toBe("confirmed");
    // Receiver (ming) can also undo a Settlement involving them
    expect((await send(ming, "POST", `/settlements/${byAdmin.id}/undo`)).status).toBe(200);
    expect((await balances(admin, group.id)).get(c)).toBe(-200);
  });

  it("a Settlement with a Member who has since left can no longer be undone", async () => {
    const { group, admin, ming, ids } = await owingGroup();
    const settled = await record(admin, group.id, {
      payerMemberId: ids.ming,
      receiverMemberId: ids.admin,
      amount: 300,
    });
    expect((await send(ming, "POST", `/groups/${group.id}/leave`)).status).toBe(204);

    const res = await send(admin, "POST", `/settlements/${settled.id}/undo`);

    expect(await errorCode(res)).toBe("MEMBER_NOT_ACTIVE");
    expect((await balances(admin, group.id)).get(ids.ming)).toBe(0);
  });

  it("nobody but an Admin records a payment between two other Members", async () => {
    const { group, mei, ids } = await owingGroup();

    const res = await postSettlement(mei, group.id, {
      payerMemberId: ids.ming,
      receiverMemberId: ids.admin,
      amount: 100,
    });

    expect(res.status).toBe(403);
  });

  it("an Admin records and confirms a Settlement for a Placeholder Member", async () => {
    const { admin, group } = await groupWith("小宇");
    const added = await send(admin, "POST", `/groups/${group.id}/members`, { name: "阿華" });
    expect(added.status).toBe(201);
    const [a, p] = (await listMembers(admin, group.id)).map((m) => m.id);
    if (a === undefined || p === undefined) throw new Error("members");
    // The Placeholder paid NT$500 for both: the Admin owes them 250.
    await createExpense(admin, group.id, twdExpense(p, [a, p], 500));

    const paid = await record(admin, group.id, {
      payerMemberId: a,
      receiverMemberId: p,
      amount: 250,
    });

    expect(paid.status).toBe("confirmed");
    expect(Object.fromEntries(await balances(admin, group.id))).toEqual({ [a]: 0, [p]: 0 });
  });

  it("a retried create with the same Idempotency-Key returns the first Settlement and writes once", async () => {
    const { group, admin, ids } = await owingGroup();
    const key = newKey();
    const body = { payerMemberId: ids.ming, receiverMemberId: ids.admin, amount: 100 };

    const first = await postSettlement(admin, group.id, body, key);
    const again = await postSettlement(admin, group.id, { ...body, amount: 150 }, key);

    expect([first.status, again.status]).toEqual([201, 201]);
    expect(await again.json<Settlement>()).toEqual(await first.json<Settlement>());
    expect((await balances(admin, group.id)).get(ids.ming)).toBe(-200);
    expect((await postSettlement(admin, group.id, body)).status).toBe(201);
  });

  it("requires an Idempotency-Key and hides Settlements from outsiders", async () => {
    const { group, admin, ming, ids } = await owingGroup();
    const body = { payerMemberId: ids.ming, receiverMemberId: ids.admin, amount: 100 };
    const keyless = await send(ming, "POST", `/groups/${group.id}/settlements`, body);
    expect(await errorCode(keyless)).toBe("IDEMPOTENCY_KEY_REQUIRED");

    const settled = await record(ming, group.id, body);
    const { admin: outsider } = await groupWith("路人");
    expect((await send(outsider, "POST", `/settlements/${settled.id}/undo`)).status).toBe(404);
    expect((await send(outsider, "GET", `/groups/${group.id}/settlements`)).status).toBe(404);
    expect((await balances(admin, group.id)).get(ids.ming)).toBe(-200);
  });
});
