import { describe, expect, it } from "vitest";
import { call, clock } from "./auth-harness.js";
import { createGroup, groupWith, listMembers, person, send } from "./groups-harness.js";
import { createExpense, twdExpense } from "./expenses-harness.js";

describe("personal spending statistics", () => {
  it("keeps summary and paginated details consistent for the same User", async () => {
    const admin = await person("Stats paging");
    const group = await createGroup(admin);
    const initialTime = clock.now;
    try {
      for (let i = 0; i < 51; i++) {
        if (i === 25) clock.now += 60_000;
        await createExpense(
          admin,
          group.id,
          twdExpense(group.me.memberId, [group.me.memberId], 600),
        );
      }
    } finally {
      clock.now = initialTime;
    }
    const summary = await (
      await send(admin, "GET", "/stats/spending?from=2026-06&to=2026-06")
    ).json();
    expect(summary).toEqual([
      { month: "2026-06", category: "food", currency: "TWD", amount: 51 * 600 },
    ]);
    type Page = { items: { id: string; amount: number }[]; nextCursor: string | null };
    const first = await (
      await send(admin, "GET", "/stats/expenses?month=2026-06&category=food")
    ).json<Page>();
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    const next = await (
      await send(
        admin,
        "GET",
        `/stats/expenses?month=2026-06&category=food&cursor=${encodeURIComponent(first.nextCursor ?? "")}`,
      )
    ).json<Page>();
    expect(next.items).toHaveLength(1);
    expect(next.nextCursor).toBeNull();
    expect(new Set([...first.items, ...next.items].map((item) => item.id)).size).toBe(51);
    expect([...first.items, ...next.items].reduce((sum, item) => sum + item.amount, 0)).toBe(
      51 * 600,
    );
  }, 20_000);
  it("keeps different Group settlement currencies separate for conversion", async () => {
    const admin = await person("Stats currencies");
    const twd = await createGroup(admin, { settlementCurrency: "TWD" });
    const jpy = await createGroup(admin, { settlementCurrency: "JPY" });
    await createExpense(admin, twd.id, twdExpense(twd.me.memberId, [twd.me.memberId], 100));
    await createExpense(
      admin,
      jpy.id,
      twdExpense(jpy.me.memberId, [jpy.me.memberId], 400, {
        originalCurrency: "JPY",
      }),
    );
    const rows = await (await send(admin, "GET", "/stats/spending")).json();
    expect(rows).toEqual(
      expect.arrayContaining([
        { month: "2026-06", category: "food", currency: "TWD", amount: 100 },
        { month: "2026-06", category: "food", currency: "JPY", amount: 400 },
      ]),
    );
    expect(
      await (await send(admin, "GET", "/stats/spending?from=2026-07&to=2026-07")).json(),
    ).toEqual([]);
    expect((await send(admin, "GET", "/stats/spending?from=2026-13&to=2026-14")).status).toBe(400);
    expect(rows).toHaveLength(2);
  });
  it("sums the signed-in Member's shares by month and category, without leaking other groups", async () => {
    const { admin, group, others } = await groupWith("Stats Alice", "Stats Bob");
    const [alice, bob] = await listMembers(admin, group.id);
    if (!alice || !bob || !others[0]) throw new Error("missing members");
    const shared = await createExpense(
      admin,
      group.id,
      twdExpense(alice.id, [alice.id, bob.id], 600),
    );
    await createExpense(admin, group.id, twdExpense(bob.id, [bob.id], 500, { category: "交通" }));
    await createExpense(
      admin,
      group.id,
      twdExpense(alice.id, [alice.id], 200, { category: "餐飲", expenseDate: "2026-07-01" }),
    );
    const response = await send(admin, "GET", "/stats/spending");
    expect(response.status).toBe(200);
    const rows = await response.json();
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        { month: "2026-06", category: "food", currency: "TWD", amount: 300 },
        { month: "2026-07", category: "餐飲", currency: "TWD", amount: 200 },
      ]),
    );
    const details = await send(admin, "GET", "/stats/expenses?month=2026-06&category=food");
    expect(
      await (await send(admin, "GET", "/stats/spending?from=2026-07&to=2026-07")).json(),
    ).toEqual([{ month: "2026-07", category: "餐飲", currency: "TWD", amount: 200 }]);
    expect(await details.json()).toMatchObject({
      items: [{ groupId: group.id, amount: 300 }],
      nextCursor: null,
    });
    const other = await person("Stats outsider");
    expect(await (await send(other, "GET", "/stats/spending")).json()).toEqual([]);
    expect(
      await (await send(other, "GET", "/stats/expenses?month=2026-06&category=food")).json(),
    ).toEqual({ items: [], nextCursor: null });
    expect((await send(admin, "GET", "/stats/expenses?month=invalid&category=food")).status).toBe(
      400,
    );
    expect((await call("/stats/spending")).status).toBe(401);
    expect((await send(admin, "DELETE", `/groups/${group.id}/expenses/${shared.id}`)).status).toBe(
      204,
    );
    expect(await (await send(admin, "GET", "/stats/spending")).json()).toEqual([
      { month: "2026-07", category: "餐飲", currency: "TWD", amount: 200 },
    ]);
    expect(
      (await send(admin, "PATCH", `/groups/${group.id}/members/${bob.id}`, { role: "admin" }))
        .status,
    ).toBe(200);
    expect((await send(admin, "POST", `/groups/${group.id}/leave`)).status).toBe(204);
    expect(await (await send(admin, "GET", "/stats/spending")).json()).toEqual([]);
    expect(
      await (await send(admin, "GET", "/stats/expenses?month=2026-06&category=food")).json(),
    ).toEqual({ items: [], nextCursor: null });
  });
});

it("removes spending when an edit unticks a Member", async () => {
  const { admin, group, others } = await groupWith("Edit payer", "Edit participant");
  const [payer, participant] = await listMembers(admin, group.id);
  const other = others[0];
  if (!payer || !participant || !other) throw new Error("missing members");
  const expense = await createExpense(
    admin,
    group.id,
    twdExpense(payer.id, [payer.id, participant.id], 600),
  );
  expect(await (await send(other, "GET", "/stats/spending")).json()).toEqual([
    { month: "2026-06", category: "food", currency: "TWD", amount: 300 },
  ]);
  expect(
    (
      await send(
        admin,
        "PATCH",
        `/groups/${group.id}/expenses/${expense.id}`,
        twdExpense(payer.id, [payer.id], 600),
        { "If-Match": String(expense.updatedAt) },
      )
    ).status,
  ).toBe(200);
  expect(await (await send(other, "GET", "/stats/spending")).json()).toEqual([]);
});

it("retries spending projection after D1 fails without reviving a deleted Expense", async () => {
  const { failDirectoryWrites } = await import("./d1-faults.js");
  const { vi } = await import("vitest");
  const admin = await person("Stats retry");
  const group = await createGroup(admin);
  const expense = await createExpense(
    admin,
    group.id,
    twdExpense(group.me.memberId, [group.me.memberId], 600),
  );
  const restoreWrites = await failDirectoryWrites();
  try {
    expect((await send(admin, "DELETE", `/groups/${group.id}/expenses/${expense.id}`)).status).toBe(
      204,
    );
    expect(await (await send(admin, "GET", "/stats/spending")).json<unknown[]>()).toHaveLength(1);
  } finally {
    await restoreWrites();
  }
  await vi.waitFor(
    async () => {
      expect(await (await send(admin, "GET", "/stats/spending")).json()).toEqual([]);
    },
    { timeout: 8000, interval: 200 },
  );
}, 12000);
