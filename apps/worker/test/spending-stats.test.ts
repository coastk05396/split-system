import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { createDb } from "../src/db/client.js";
import { members } from "../src/db/schema.js";
import { call } from "./auth-harness.js";
import { createGroup, groupWith, listMembers, person, send } from "./groups-harness.js";
import { createExpense, twdExpense } from "./expenses-harness.js";

describe("personal spending statistics", () => {
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
    await createDb(env.DB)
      .update(members)
      .set({ status: "former" })
      .where(eq(members.id, alice.id));
    expect(await (await send(admin, "GET", "/stats/spending")).json()).toEqual([]);
    expect(
      await (await send(admin, "GET", "/stats/expenses?month=2026-06&category=food")).json(),
    ).toEqual({ items: [], nextCursor: null });
  });
});
