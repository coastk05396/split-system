import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db/client.js";
import { isConstraintError } from "../src/db/errors.js";
import { expenses, groups, members, settlements } from "../src/db/schema.js";

const NOW = 1_750_000_000_000;
const db = createDb(env.DB);

async function failure(write: Promise<unknown>): Promise<unknown> {
  try {
    await write;
  } catch (error) {
    return error;
  }
  throw new Error("expected the write to fail");
}

async function seedGroup(id: string) {
  await db.batch([
    db.insert(groups).values({ id, name: "日本行", createdAt: NOW, updatedAt: NOW }),
    db.insert(members).values({
      id: `${id}-m1`,
      groupId: id,
      placeholderName: "小宇",
      status: "placeholder",
      createdAt: NOW,
    }),
    db.insert(members).values({
      id: `${id}-m2`,
      groupId: id,
      placeholderName: "阿明",
      status: "placeholder",
      createdAt: NOW,
    }),
  ]);
}

function expense(id: string, groupId: string, idempotencyKey: string | null) {
  return {
    id,
    groupId,
    creatorMemberId: `${groupId}-m1`,
    description: "晚餐",
    category: "food",
    originalAmount: 2160,
    originalCurrency: "TWD",
    fxRateScaled: 1_000_000,
    fxDate: "2026-06-13",
    settlementAmount: 2160,
    splitType: "equal",
    expenseDate: "2026-06-13",
    idempotencyKey,
    createdAt: NOW,
    updatedAt: NOW,
  } as const;
}

describe("migrated D1 schema", () => {
  it("rolls the whole batch back when one statement fails", async () => {
    await seedGroup("g1");
    const write = db.batch([
      db.insert(expenses).values(expense("e1", "g1", "k1")),
      db.update(members).set({ netBalance: 1080 }).where(eq(members.id, "g1-m1")),
      // Fails the amount CHECK: an Expense is 1 to 99,999,999 units.
      db.insert(expenses).values({ ...expense("e2", "g1", "k2"), originalAmount: 0 }),
    ]);
    expect(isConstraintError(await failure(write), "CHECK")).toBe(true);

    expect(await db.select().from(expenses).where(eq(expenses.groupId, "g1"))).toEqual([]);
    const [member] = await db.select().from(members).where(eq(members.id, "g1-m1"));
    expect(member?.netBalance).toBe(0);
  });

  it("rejects a second Expense with the same idempotency key", async () => {
    await seedGroup("g2");
    await db.insert(expenses).values(expense("e1", "g2", "same-key"));
    const error = await failure(db.insert(expenses).values(expense("e2", "g2", "same-key")));
    expect(isConstraintError(error, "UNIQUE", "expenses.idempotency_key")).toBe(true);
  });

  it("rejects a second Settlement with the same idempotency key", async () => {
    await seedGroup("g3");
    const settlement = (id: string) => ({
      id,
      groupId: "g3",
      payerMemberId: "g3-m1",
      receiverMemberId: "g3-m2",
      amount: 540,
      idempotencyKey: "pay-1",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await db.insert(settlements).values(settlement("s1"));
    const error = await failure(db.insert(settlements).values(settlement("s2")));
    expect(isConstraintError(error, "UNIQUE", "settlements.idempotency_key")).toBe(true);
  });

  it("keeps placeholder Members free of a User and requires their name", async () => {
    await seedGroup("g4");
    const write = db
      .insert(members)
      .values({ id: "g4-m3", groupId: "g4", status: "placeholder", createdAt: NOW });
    expect(isConstraintError(await failure(write), "CHECK")).toBe(true);
  });

  it("refuses a Settlement from a Member to themselves", async () => {
    await seedGroup("g5");
    const write = db.insert(settlements).values({
      id: "s1",
      groupId: "g5",
      payerMemberId: "g5-m1",
      receiverMemberId: "g5-m1",
      amount: 540,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(isConstraintError(await failure(write), "CHECK")).toBe(true);
  });
});
