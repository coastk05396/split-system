import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db/client.js";
import { expenses, groups, members } from "../src/db/schema.js";
import { call, clock, type Session } from "./auth-harness.js";
import {
  at,
  createGroup,
  errorCode,
  type GroupBody,
  groupWith,
  person,
  seedExpense,
  send,
} from "./groups-harness.js";

const db = createDb(env.DB);
const NOW = 1_750_000_000_000;

describe("POST /groups and GET /groups/:id", () => {
  it("creates a Running Tab with the creator as its only Member and Admin", async () => {
    const yu = await person("小宇");
    const group = await createGroup(yu, { name: "室友帳", settlementCurrency: "USD" });
    expect(group).toMatchObject({
      name: "室友帳",
      settlementCurrency: "USD",
      defaultExpenseCurrency: "TWD",
      isTrip: false,
      tripDestination: null,
      settlementCurrencyLocked: false,
      memberCount: 1,
      me: { role: "admin", balance: 0 },
    });

    const res = await send(yu, "GET", `/groups/${group.id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(group);
  });

  it("creates a Trip with its destination and dates", async () => {
    const yu = await person("小宇");
    const group = await createGroup(yu, {
      isTrip: true,
      tripDestination: "台南",
      tripStartDate: "2026-06-13",
      tripEndDate: "2026-06-15",
      defaultExpenseCurrency: "USD",
    });
    expect(group).toMatchObject({
      isTrip: true,
      tripDestination: "台南",
      tripStartDate: "2026-06-13",
      tripEndDate: "2026-06-15",
      defaultExpenseCurrency: "USD",
    });
  });

  it("refuses a Trip longer than 31 days", async () => {
    const yu = await person("小宇");
    const res = await send(yu, "POST", "/groups", {
      name: "環島",
      isTrip: true,
      tripStartDate: "2026-06-01",
      tripEndDate: "2026-07-02",
    });
    expect(res.status).toBe(400);
  });

  it("answers 404 to a signed-in person who is not a Member", async () => {
    const group = await createGroup(await person("小宇"));
    const stranger = await person("路人");
    const res = await send(stranger, "GET", `/groups/${group.id}`);
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("NOT_FOUND");
  });

  it("requires sign-in", async () => {
    expect((await call("/groups", { method: "GET" })).status).toBe(401);
  });
});

describe("GET /groups", () => {
  it("lists only the Groups the User is an active Member of", async () => {
    const yu = await person("小宇");
    const first = await createGroup(yu, { name: "室友帳" });
    const second = await createGroup(yu, { name: "台南" });
    await createGroup(await person("路人"), { name: "別人的" });
    const res = await send(yu, "GET", "/groups");
    expect(res.status).toBe(200);
    const list = await res.json<GroupBody[]>();
    expect(list.map((g) => g.id).sort()).toEqual([first.id, second.id].sort());
  });

  it("refuses a 21st Group for one User", async () => {
    const yu = await person("小宇");
    const groupIds = Array.from({ length: 20 }, () => crypto.randomUUID());
    for (const id of groupIds) {
      await db.insert(groups).values({ id, name: "舊帳", createdAt: NOW, updatedAt: NOW });
      await db.insert(members).values({
        id: `${id}-m`,
        groupId: id,
        userId: yu.userId,
        role: "admin",
        createdAt: NOW,
      });
    }
    const res = await send(yu, "POST", "/groups", { name: "第21個" });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("GROUP_LIMIT_REACHED");
  });
});

describe("PATCH /groups/:id", () => {
  const patch = (s: Session, g: GroupBody, body: unknown, updatedAt = g.updatedAt) =>
    send(s, "PATCH", `/groups/${g.id}`, body, { "If-Match": String(updatedAt) });

  it("lets an Admin rename the Group and switch the Trip module on", async () => {
    const yu = await person("小宇");
    const group = await createGroup(yu);
    clock.now += 1000;
    const res = await patch(yu, group, {
      name: "台南三日",
      isTrip: true,
      tripStartDate: "2026-06-13",
      tripEndDate: "2026-06-15",
    });
    expect(res.status).toBe(200);
    const body = await res.json<GroupBody>();
    expect(body).toMatchObject({ name: "台南三日", isTrip: true, tripEndDate: "2026-06-15" });
    expect(body.updatedAt).toBeGreaterThan(group.updatedAt);
  });

  it("forbids a plain Member", async () => {
    const { group, others } = await groupWith("小宇", "阿明");
    const res = await patch(at(others, 0), group, { name: "改名" });
    expect(res.status).toBe(403);
  });

  it("answers 409 with the current Group when someone else edited it first", async () => {
    const yu = await person("小宇");
    const group = await createGroup(yu);
    clock.now += 1000;
    expect((await patch(yu, group, { name: "第一次" })).status).toBe(200);
    const res = await patch(yu, group, { name: "第二次" });
    expect(res.status).toBe(409);
    const body = await res.json<{ error: { code: string; details: { current: GroupBody } } }>();
    expect(body.error.code).toBe("EDIT_CONFLICT");
    expect(body.error.details.current.name).toBe("第一次");
  });

  it("requires If-Match", async () => {
    const yu = await person("小宇");
    const group = await createGroup(yu);
    const res = await send(yu, "PATCH", `/groups/${group.id}`, { name: "x" });
    expect(await errorCode(res)).toBe("IF_MATCH_REQUIRED");
  });

  it("refuses Trip dates that would make the Trip longer than 31 days", async () => {
    const yu = await person("小宇");
    const group = await createGroup(yu, { tripStartDate: "2026-06-01" });
    const res = await patch(yu, group, { tripEndDate: "2026-07-02" });
    expect(res.status).toBe(400);
  });

  it("locks the Settlement currency once the Group has an Expense", async () => {
    const yu = await person("小宇");
    const group = await createGroup(yu);
    clock.now += 1000;
    const changed = await patch(yu, group, { settlementCurrency: "USD" });
    expect(changed.status).toBe(200);
    const usd = await changed.json<GroupBody>();

    await seedExpense(group.id, usd.me.memberId);
    const locked = await send(yu, "GET", `/groups/${group.id}`);
    expect((await locked.json<GroupBody>()).settlementCurrencyLocked).toBe(true);

    clock.now += 1000;
    const res = await patch(yu, usd, { settlementCurrency: "TWD" });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("SETTLEMENT_CURRENCY_LOCKED");
    // The default Expense currency still changes any time.
    expect((await patch(yu, usd, { defaultExpenseCurrency: "USD" })).status).toBe(200);
  });
});

describe("DELETE /groups/:id", () => {
  it("lets an Admin hard-delete the Group with its Expenses", async () => {
    const yu = await person("小宇");
    const group = await createGroup(yu);
    await seedExpense(group.id, group.me.memberId);
    const res = await send(yu, "DELETE", `/groups/${group.id}`);
    expect(res.status).toBe(204);
    expect(await db.select().from(groups).where(eq(groups.id, group.id))).toEqual([]);
    expect(await db.select().from(expenses).where(eq(expenses.groupId, group.id))).toEqual([]);
    expect((await send(yu, "GET", `/groups/${group.id}`)).status).toBe(404);
  });

  it("forbids a plain Member and hides the Group from outsiders", async () => {
    const { group, others } = await groupWith("小宇", "阿明");
    expect((await send(at(others, 0), "DELETE", `/groups/${group.id}`)).status).toBe(403);
    const stranger = await person("路人");
    expect((await send(stranger, "DELETE", `/groups/${group.id}`)).status).toBe(404);
  });
});
