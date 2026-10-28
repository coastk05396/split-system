import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db/client.js";
import { expenses, groups, members } from "../src/db/schema.js";
import { bearer, call, json, signIn, uniqueSub, withCookie } from "./auth-harness.js";

const NOW = 1_750_000_000_000;
const db = createDb(env.DB);

/** Group routes come in a later ticket, so Groups are seeded straight into D1. */
async function seedGroup(
  groupId: string,
  people: { memberId: string; userId: string; role: "admin" | "member"; balance?: number }[],
) {
  await db.insert(groups).values({ id: groupId, name: "日本行", createdAt: NOW, updatedAt: NOW });
  for (const p of people) {
    await db.insert(members).values({
      id: p.memberId,
      groupId,
      userId: p.userId,
      role: p.role,
      nickname: "小宇本人",
      netBalance: p.balance ?? 0,
      createdAt: NOW,
    });
  }
}

function deleteMe(accessToken: string) {
  return call("/me", { method: "DELETE", headers: bearer(accessToken) });
}

describe("DELETE /me", () => {
  it("keeps the deleted User's history as a Former Member named 已刪除的使用者", async () => {
    const yu = await signIn("google", uniqueSub("yu"), "小宇");
    const ming = await signIn("line", uniqueSub("ming"), "阿明");
    const groupId = crypto.randomUUID();
    await seedGroup(groupId, [
      { memberId: `${groupId}-yu`, userId: yu.userId, role: "member" },
      { memberId: `${groupId}-ming`, userId: ming.userId, role: "admin" },
    ]);
    await db.insert(expenses).values({
      id: `${groupId}-e1`,
      groupId,
      creatorMemberId: `${groupId}-yu`,
      description: "晚餐",
      category: "food",
      originalAmount: 2160,
      originalCurrency: "TWD",
      fxRateScaled: 1_000_000,
      fxDate: "2026-06-13",
      settlementAmount: 2160,
      splitType: "equal",
      expenseDate: "2026-06-13",
      createdAt: NOW,
      updatedAt: NOW,
    });

    const res = await deleteMe(yu.accessToken);
    expect(res.status).toBe(204);
    expect(res.headers.get("Set-Cookie")).toMatch(/refresh=;/);

    const [former] = await db
      .select()
      .from(members)
      .where(eq(members.id, `${groupId}-yu`));
    expect(former).toMatchObject({ userId: null, status: "former", nickname: "已刪除的使用者" });
    const [expense] = await db
      .select()
      .from(expenses)
      .where(eq(expenses.id, `${groupId}-e1`));
    expect(expense?.creatorMemberId).toBe(`${groupId}-yu`);

    // Identities and sessions are gone: the token is signed out and the Identity is fresh.
    expect((await call("/me", { headers: bearer(yu.accessToken) })).status).toBe(401);
    expect((await call("/auth/refresh", withCookie(yu.refresh))).status).toBe(401);
  });

  it("refuses while a Balance in any Group is not zero", async () => {
    const yu = await signIn("google", uniqueSub("owes"));
    const ming = await signIn("google", uniqueSub("owed"));
    const groupId = crypto.randomUUID();
    await seedGroup(groupId, [
      { memberId: `${groupId}-yu`, userId: yu.userId, role: "admin", balance: -540 },
      { memberId: `${groupId}-ming`, userId: ming.userId, role: "admin", balance: 540 },
    ]);
    const res = await deleteMe(yu.accessToken);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: "BALANCE_NOT_ZERO", details: { groupIds: [groupId] } },
    });
    expect((await call("/me", { headers: bearer(yu.accessToken) })).status).toBe(200);
  });

  it("refuses for the last admin of a Group that still has other Members", async () => {
    const yu = await signIn("google", uniqueSub("admin"));
    const ming = await signIn("google", uniqueSub("plain"));
    const groupId = crypto.randomUUID();
    await seedGroup(groupId, [
      { memberId: `${groupId}-yu`, userId: yu.userId, role: "admin" },
      { memberId: `${groupId}-ming`, userId: ming.userId, role: "member" },
    ]);
    const res = await deleteMe(yu.accessToken);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: "LAST_ADMIN", details: { groupIds: [groupId] } },
    });
  });

  it("deletes a Group where the User is the only active Member", async () => {
    const yu = await signIn("line", uniqueSub("solo"));
    const groupId = crypto.randomUUID();
    await seedGroup(groupId, [{ memberId: `${groupId}-yu`, userId: yu.userId, role: "admin" }]);
    expect((await deleteMe(yu.accessToken)).status).toBe(204);
    expect(await db.select().from(groups).where(eq(groups.id, groupId))).toEqual([]);
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
