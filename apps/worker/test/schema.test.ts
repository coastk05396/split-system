import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db/client.js";
import { isConstraintError } from "../src/db/errors.js";
import {
  groupDirectory,
  groupMemberSummary,
  invites,
  settlementRoutes,
  users,
} from "../src/db/schema.js";

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

describe("retained D1 schema constraints", () => {
  it("rejects duplicate invite tokens", async () => {
    await db.insert(invites).values({
      id: "inv-1",
      groupId: "g-test",
      token: "tok-dup",
      expiresAt: NOW + 1000,
      createdAt: NOW,
    });
    const error = await failure(
      db.insert(invites).values({
        id: "inv-2",
        groupId: "g-test-2",
        token: "tok-dup",
        expiresAt: NOW + 2000,
        createdAt: NOW,
      }),
    );
    expect(isConstraintError(error, "UNIQUE", "invites.token")).toBe(true);
  });

  it("rejects duplicate settlement ids in settlement_routes", async () => {
    await db.insert(settlementRoutes).values({
      settlementId: "set-1",
      groupId: "g-test",
      createdAt: NOW,
    });
    const error = await failure(
      db.insert(settlementRoutes).values({
        settlementId: "set-1",
        groupId: "g-test-2",
        createdAt: NOW,
      }),
    );
    expect(isConstraintError(error, "UNIQUE", "settlement_routes.settlement_id")).toBe(true);
  });

  it("enforces composite primary key on group_member_summary", async () => {
    await db.insert(groupMemberSummary).values({
      userId: "u-1",
      groupId: "g-1",
      memberId: "m-1",
      role: "admin",
      netBalance: 0,
      rev: 1,
    });
    const error = await failure(
      db.insert(groupMemberSummary).values({
        userId: "u-1",
        groupId: "g-1",
        memberId: "m-2",
        role: "member",
        netBalance: 100,
        rev: 2,
      }),
    );
    expect(isConstraintError(error, "UNIQUE")).toBe(true);
  });

  it("enforces groupDirectory primary key", async () => {
    await db.insert(groupDirectory).values({
      groupId: "gd-1",
      name: "Group 1",
      settlementCurrency: "TWD",
      createdAt: NOW,
      updatedAt: NOW,
    });
    const error = await failure(
      db.insert(groupDirectory).values({
        groupId: "gd-1",
        name: "Group 1 duplicate",
        settlementCurrency: "USD",
        createdAt: NOW,
        updatedAt: NOW,
      }),
    );
    expect(isConstraintError(error, "UNIQUE", "group_directory.group_id")).toBe(true);
  });
});

describe("users settings constraints", () => {
  const row = (id: string) => ({ id, displayName: "小宇", createdAt: NOW, updatedAt: NOW });

  it("accepts every shipped currency and language", async () => {
    await db.insert(users).values({ ...row("u-jpy"), preferredCurrency: "JPY", language: "en" });
    await db.insert(users).values({ ...row("u-thb"), preferredCurrency: "THB", language: "zh-TW" });
    const [saved] = await db.select().from(users).where(eq(users.id, "u-jpy"));
    expect(saved).toMatchObject({ preferredCurrency: "JPY", language: "en" });
  });

  it("refuses a currency or language outside the shipped lists", async () => {
    const badCurrency = await failure(
      env.DB.prepare(
        "INSERT INTO users (id, display_name, preferred_currency, created_at, updated_at) VALUES ('u-gbp', 'x', 'GBP', 1, 1)",
      ).run(),
    );
    expect(isConstraintError(badCurrency, "CHECK")).toBe(true);
    const badLanguage = await failure(
      env.DB.prepare(
        "INSERT INTO users (id, display_name, language, created_at, updated_at) VALUES ('u-ja', 'x', 'ja', 1, 1)",
      ).run(),
    );
    expect(isConstraintError(badLanguage, "CHECK")).toBe(true);
  });
});
