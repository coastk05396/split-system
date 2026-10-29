import type { Expense, ExpensePage } from "@split/shared";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db/client.js";
import { fxRates } from "../src/db/schema.js";
import { clock } from "./auth-harness.js";
import { createGroup, groupWith, listMembers, person, send } from "./groups-harness.js";
import { balances, createExpense, newKey, postExpense, twdExpense } from "./expenses-harness.js";

describe("Expenses and Balances", () => {
  it("an equal NT$100 Expense moves Balances by 34/33/33 with the payer taking the leftover", async () => {
    const { admin, group } = await groupWith("小宇", "阿明", "小美");
    const [a, b, c] = (await listMembers(admin, group.id)).map((m) => m.id);
    if (a === undefined || b === undefined || c === undefined) throw new Error("members");

    const expense = await createExpense(admin, group.id, twdExpense(b, [a, b, c], 100));

    expect(expense.settlementAmount).toBe(100);
    expect(expense.splits.map((s) => s.settlementAmount)).toEqual([33, 34, 33]);
    expect(Object.fromEntries(await balances(admin, group.id))).toEqual({
      [a]: -33,
      [b]: 66,
      [c]: -33,
    });
  });

  it("a retried create with the same Idempotency-Key returns the first Expense and writes once", async () => {
    const { admin, group, others } = await groupWith("小宇", "阿明");
    const [a, b] = (await listMembers(admin, group.id)).map((m) => m.id);
    if (a === undefined || b === undefined || others[0] === undefined) throw new Error("members");
    const key = newKey();

    const first = await postExpense(admin, group.id, twdExpense(a, [a, b], 600), key);
    const again = await postExpense(admin, group.id, twdExpense(a, [a, b], 900), key);

    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    const [one, two] = [await first.json<Expense>(), await again.json<Expense>()];
    expect(two).toEqual(one);
    expect(await balances(admin, group.id)).toEqual(
      new Map([
        [a, 300],
        [b, -300],
      ]),
    );
    // The key belongs to its creator: another Member's same key is a new Expense.
    const theirs = await postExpense(others[0], group.id, twdExpense(b, [a, b], 200), key);
    expect((await theirs.json<Expense>()).id).not.toBe(one.id);
  });

  it("an edit with a stale If-Match is 409 with the current Expense and changes nothing", async () => {
    const { admin, group } = await groupWith("小宇", "阿明");
    const [a, b] = (await listMembers(admin, group.id)).map((m) => m.id);
    if (a === undefined || b === undefined) throw new Error("members");
    const created = await createExpense(admin, group.id, twdExpense(a, [a, b], 600));
    const path = `/groups/${group.id}/expenses/${created.id}`;

    const edited = await send(admin, "PATCH", path, twdExpense(b, [a, b], 1000), {
      "If-Match": String(created.updatedAt),
    });
    expect(edited.status).toBe(200);
    expect(await balances(admin, group.id)).toEqual(
      new Map([
        [a, -500],
        [b, 500],
      ]),
    );

    const stale = await send(admin, "PATCH", path, twdExpense(a, [a], 50), {
      "If-Match": String(created.updatedAt),
    });
    expect(stale.status).toBe(409);
    const body = await stale.json<{ error: { code: string; details: { current: Expense } } }>();
    expect(body.error.code).toBe("EDIT_CONFLICT");
    expect(body.error.details.current.originalAmount).toBe(1000);
    expect(await balances(admin, group.id)).toEqual(
      new Map([
        [a, -500],
        [b, 500],
      ]),
    );
  });

  it("deleting an Expense reverses its Balances and it is gone", async () => {
    const { admin, group } = await groupWith("小宇", "阿明");
    const [a, b] = (await listMembers(admin, group.id)).map((m) => m.id);
    if (a === undefined || b === undefined) throw new Error("members");
    const created = await createExpense(admin, group.id, twdExpense(a, [a, b], 600));
    const path = `/groups/${group.id}/expenses/${created.id}`;

    expect((await send(admin, "DELETE", path)).status).toBe(204);
    expect(await balances(admin, group.id)).toEqual(
      new Map([
        [a, 0],
        [b, 0],
      ]),
    );
    expect((await send(admin, "GET", path)).status).toBe(404);
  });

  it("a US$ Expense with two payers converts to NT$ lines that add up exactly", async () => {
    const { admin, group } = await groupWith("小宇", "阿明", "小美");
    const [a, b, c] = (await listMembers(admin, group.id)).map((m) => m.id);
    if (a === undefined || b === undefined || c === undefined) throw new Error("members");

    const expense = await createExpense(admin, group.id, {
      ...twdExpense(a, [a, b, c]),
      originalAmount: 1000,
      originalCurrency: "USD",
      fxRateScaled: 31_523_400,
      settlementAmount: 315,
      payers: [
        { memberId: a, amountMinor: 500 },
        { memberId: c, amountMinor: 500 },
      ],
    });

    expect(expense.payers.map((p) => p.settlementAmount)).toEqual([158, 157]);
    // US$ 3.34/3.33/3.33 (payer first) become NT$ 106/104/105: leftovers go to payers first.
    expect(expense.splits.map((s) => s.amountMinor)).toEqual([334, 333, 333]);
    expect(expense.splits.map((s) => s.settlementAmount)).toEqual([106, 104, 105]);
    expect(Object.fromEntries(await balances(admin, group.id))).toEqual({
      [a]: 52,
      [b]: -104,
      [c]: 52,
    });
    const locked = await send(admin, "GET", `/groups/${group.id}`);
    expect(
      (await locked.json<{ settlementCurrencyLocked: boolean }>()).settlementCurrencyLocked,
    ).toBe(true);
  });

  it("rejects payers or split Members outside the Group, and a converted amount the rate does not give", async () => {
    const { admin, group } = await groupWith("小宇");
    const other = await groupWith("阿明");
    const [a] = (await listMembers(admin, group.id)).map((m) => m.id);
    const [outsider] = (await listMembers(other.admin, other.group.id)).map((m) => m.id);
    if (a === undefined || outsider === undefined) throw new Error("members");

    const foreign = await postExpense(admin, group.id, twdExpense(a, [a, outsider]));
    expect(foreign.status).toBe(400);
    expect(JSON.stringify(await foreign.json())).toContain("MEMBER_NOT_IN_GROUP");

    const mismatch = await postExpense(admin, group.id, {
      ...twdExpense(a, [a], 1000),
      originalCurrency: "USD",
      fxRateScaled: 31_523_400,
      settlementAmount: 400,
    });
    expect(mismatch.status).toBe(400);
    expect(JSON.stringify(await mismatch.json())).toContain("SETTLEMENT_AMOUNT_MISMATCH");
    expect(await balances(admin, group.id)).toEqual(new Map([[a, 0]]));

    // When an official reference rate exists in D1, client cannot forge a non-custom rate
    await createDb(env.DB).insert(fxRates).values({
      rateDate: "2026-07-01",
      baseCurrency: "USD",
      quoteCurrency: "TWD",
      rateScaled: 31_523_400,
      publishedDate: null,
      fetchedAt: 1_700_000_000_000,
    });

    const forged = await postExpense(admin, group.id, {
      ...twdExpense(a, [a], 1000),
      originalCurrency: "USD",
      fxRateScaled: 30_000_000,
      fxDate: "2026-07-01",
      settlementAmount: 300,
      isCustomRate: false,
    });
    expect(forged.status).toBe(400);
    expect(JSON.stringify(await forged.json())).toContain("RATE_MISMATCH_WITH_REFERENCE");
  });

  it("links an Expense only to a Stop of the same Group", async () => {
    const trip = { isTrip: true, tripStartDate: "2026-07-01", tripEndDate: "2026-07-03" };
    const admin = await person("小宇");
    const mine = await createGroup(admin, trip);
    const theirs = await createGroup(admin, trip);
    const addStop = async (groupId: string) => {
      const res = await send(admin, "POST", `/groups/${groupId}/stops`, {
        dayDate: "2026-07-01",
        title: "赤崁樓",
        category: "景點",
      });
      return (await res.json<{ id: string }>()).id;
    };
    const [myStop, theirStop] = [await addStop(mine.id), await addStop(theirs.id)];
    const me = mine.me.memberId;

    const foreign = await postExpense(
      admin,
      mine.id,
      twdExpense(me, [me], 100, { stopId: theirStop }),
    );
    expect(foreign.status).toBe(400);
    expect(JSON.stringify(await foreign.json())).toContain("STOP_NOT_IN_GROUP");

    const linked = await createExpense(
      admin,
      mine.id,
      twdExpense(me, [me], 100, { stopId: myStop }),
    );
    expect(linked.stopId).toBe(myStop);
  });

  it("answers 404 to someone who is not a Member", async () => {
    const { admin, group } = await groupWith("小宇");
    const stranger = await person("路人");
    const [a] = (await listMembers(admin, group.id)).map((m) => m.id);
    if (a === undefined) throw new Error("members");
    expect((await postExpense(stranger, group.id, twdExpense(a, [a]))).status).toBe(404);
    expect((await send(stranger, "GET", `/groups/${group.id}/balances`)).status).toBe(404);
  });

  it("lists Expenses 50 a page, newest first, with a cursor to the next page", async () => {
    const { admin, group } = await groupWith("小宇");
    const [a] = (await listMembers(admin, group.id)).map((m) => m.id);
    if (a === undefined) throw new Error("members");
    const created: string[] = [];
    for (let i = 0; i < 52; i += 1) {
      // Stays under the 30-writes-a-minute limit and keeps IDs in creation order.
      clock.now += 2_100;
      created.push((await createExpense(admin, group.id, twdExpense(a, [a], 10 + i))).id);
    }

    const first = await send(admin, "GET", `/groups/${group.id}/expenses`);
    const page1 = await first.json<ExpensePage>();
    expect(page1.expenses).toHaveLength(50);
    expect(page1.nextCursor).not.toBeNull();
    const next = await send(
      admin,
      "GET",
      `/groups/${group.id}/expenses?cursor=${page1.nextCursor ?? ""}`,
    );
    const page2 = await next.json<ExpensePage>();
    expect(page2.nextCursor).toBeNull();
    const ids = [...page1.expenses, ...page2.expenses].map((e) => e.id);
    expect(ids).toEqual([...created].reverse());
  }, 300_000);
});
