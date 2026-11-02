import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db/client.js";
import { settlementRoutes } from "../src/db/schema.js";
import { newKey, twdExpense, createExpense } from "./expenses-harness.js";
import { groupWith, listMembers, person, send } from "./groups-harness.js";

const db = createDb(env.DB);

describe("Settlement ID routing (Ticket 14)", () => {
  async function owingGroup() {
    const { admin, group, others } = await groupWith("宇宇", "明明");
    const ming = others[0];
    if (!ming) throw new Error("ming missing");
    const [a, b] = (await listMembers(admin, group.id)).map((m) => m.id);
    if (!a || !b) throw new Error("members missing");
    await createExpense(admin, group.id, twdExpense(a, [a, b], 1000));
    return { admin, ming, group, a, b };
  }

  it("routes /settlements/:sid/undo using the D1 settlement_routes lookup", async () => {
    const { admin, ming, group, a, b } = await owingGroup();

    // Ming records settlement
    const settleRes = await send(
      ming,
      "POST",
      `/groups/${group.id}/settlements`,
      { payerMemberId: b, receiverMemberId: a, amount: 200 },
      { "Idempotency-Key": newKey() },
    );
    expect(settleRes.status).toBe(201);
    const settlement = await settleRes.json<{ id: string; status: string }>();

    // Lookup row exists in settlement_routes
    const route = await db
      .select()
      .from(settlementRoutes)
      .where(eq(settlementRoutes.settlementId, settlement.id));
    expect(route).toHaveLength(1);
    expect(route[0]?.groupId).toBe(group.id);

    // Call /settlements/:sid/undo without group id
    const undoRes = await send(admin, "POST", `/settlements/${settlement.id}/undo`);
    expect(undoRes.status).toBe(200);
    const undone = await undoRes.json<{ id: string; status: string }>();
    expect(undone.status).toBe("undone");
  });

  it("falls back to user's reservation groups when D1 lookup is missing", async () => {
    const { admin, ming, group, a, b } = await owingGroup();

    // Ming records settlement
    const settleRes = await send(
      ming,
      "POST",
      `/groups/${group.id}/settlements`,
      { payerMemberId: b, receiverMemberId: a, amount: 150 },
      { "Idempotency-Key": newKey() },
    );
    expect(settleRes.status).toBe(201);
    const settlement = await settleRes.json<{ id: string; status: string }>();

    // Simulate D1 push failure by deleting the row from settlement_routes
    await db.delete(settlementRoutes).where(eq(settlementRoutes.settlementId, settlement.id));
    const emptyRoute = await db
      .select()
      .from(settlementRoutes)
      .where(eq(settlementRoutes.settlementId, settlement.id));
    expect(emptyRoute).toHaveLength(0);

    // The endpoint should fall back to user's reservations, ask the ledger DO, and succeed
    const undoRes = await send(admin, "POST", `/settlements/${settlement.id}/undo`);
    expect(undoRes.status).toBe(200);
    const undone = await undoRes.json<{ id: string; status: string }>();
    expect(undone.status).toBe("undone");
  });

  it("refuses an outsider with 404 when settlement is not in their groups", async () => {
    const { ming, group, a, b } = await owingGroup();

    const settleRes = await send(
      ming,
      "POST",
      `/groups/${group.id}/settlements`,
      { payerMemberId: b, receiverMemberId: a, amount: 100 },
      { "Idempotency-Key": newKey() },
    );
    expect(settleRes.status).toBe(201);
    const settlement = await settleRes.json<{ id: string }>();

    // Stranger calls undo
    const stranger = await person("陌生人");
    const res = await send(stranger, "POST", `/settlements/${settlement.id}/undo`);
    expect(res.status).toBe(404);
  });

  it("rate limits repeated fallback lookups for non-existent settlements", async () => {
    const user = await person("查查人");
    let hitRateLimit = false;

    // Route group settlement_lookup_fallback has a limit of 30 requests per minute
    for (let i = 0; i < 35; i++) {
      const res = await send(user, "POST", `/settlements/non-existent-${i}/undo`);
      if (res.status === 429) {
        hitRateLimit = true;
        expect(res.headers.get("Retry-After")).toBeDefined();
        break;
      }
    }
    expect(hitRateLimit).toBe(true);
  });

  it("deletes settlement_routes mappings when group is deleted and prevents late restore", async () => {
    const { admin, ming, group, a, b } = await owingGroup();

    const settleRes = await send(
      ming,
      "POST",
      `/groups/${group.id}/settlements`,
      { payerMemberId: b, receiverMemberId: a, amount: 100 },
      { "Idempotency-Key": newKey() },
    );
    expect(settleRes.status).toBe(201);
    const settlement = await settleRes.json<{ id: string }>();

    // Verify it exists in settlement_routes
    expect(
      await db
        .select()
        .from(settlementRoutes)
        .where(eq(settlementRoutes.settlementId, settlement.id)),
    ).toHaveLength(1);

    // Delete group
    expect((await send(admin, "DELETE", `/groups/${group.id}`)).status).toBe(204);

    // Mappings in settlement_routes must be gone
    expect(
      await db
        .select()
        .from(settlementRoutes)
        .where(eq(settlementRoutes.settlementId, settlement.id)),
    ).toHaveLength(0);

    // Attempting to undo returns 404
    expect((await send(admin, "POST", `/settlements/${settlement.id}/undo`)).status).toBe(404);
  });
});
