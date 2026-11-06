import { MAX_GROUPS_PER_USER, settlementInputSchema } from "@split/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppEnv } from "../api.js";
import { requireUser } from "../auth/require-user.js";
import { createDb, type Db } from "../db/client.js";
import { groupReservations, settlementRoutes as settlementRoutesTable } from "../db/schema.js";
import type { AppDeps } from "../deps.js";
import { ApiError } from "../errors.js";
import type { Bindings } from "../env.js";
import { requireMember } from "../groups/membership.js";
import { groupLedger } from "../ledger-client.js";
import { consumeRateLimit, rateLimit } from "../rate-limit.js";
import { parseBody, requireIdempotencyKey } from "../request-guards.js";

async function resolveSettlementGroup(
  db: Db,
  sid: string,
  userId: string,
  env: Bindings,
  now: number,
): Promise<string> {
  let row: { groupId: string } | undefined;
  try {
    const res = await db
      .select({ groupId: settlementRoutesTable.groupId })
      .from(settlementRoutesTable)
      .where(eq(settlementRoutesTable.settlementId, sid));
    row = res[0];
  } catch {
    throw new ApiError("SERVICE_UNAVAILABLE");
  }

  if (row !== undefined) {
    return row.groupId;
  }

  // Lookup is missing (drain failure or pending push). Fallback: check user's reservations.
  await consumeRateLimit(db, userId, "settlement_lookup_fallback", now);

  let userReservations: Array<{ groupId: string }>;
  try {
    userReservations = await db
      .select({ groupId: groupReservations.groupId })
      .from(groupReservations)
      .where(and(eq(groupReservations.userId, userId), eq(groupReservations.status, "active")));
  } catch {
    throw new ApiError("SERVICE_UNAVAILABLE");
  }

  const candidateGroups = userReservations.slice(0, MAX_GROUPS_PER_USER);

  for (const { groupId } of candidateGroups) {
    try {
      if (await groupLedger(env, groupId).settlementCheck(userId, sid)) {
        return groupId;
      }
    } catch {
      // ignore
    }
  }

  throw new ApiError("NOT_FOUND");
}

export function settlementRoutes(deps: AppDeps) {
  const signedIn = requireUser(deps.now),
    limited = rateLimit("expense_write", deps.now);
  return new Hono<AppEnv>()
    .get("/groups/:id/settlements", signedIn, async (c) => {
      const me = await requireMember(createDb(c.env.DB), c.req.param("id"), c.var.userId);
      const result = await groupLedger(c.env, me.groupId).settlement({
        action: "list",
        actorId: me.id,
        now: deps.now(),
        cursor: c.req.query("cursor"),
      });
      c.header("X-Group-Rev", String(result.rev));
      return c.json(result.value, 200);
    })
    .post("/groups/:id/settlements", signedIn, limited, async (c) => {
      const me = await requireMember(createDb(c.env.DB), c.req.param("id"), c.var.userId);
      const key = requireIdempotencyKey(c),
        input = await parseBody(c, settlementInputSchema);
      const result = await groupLedger(c.env, me.groupId).settlement({
        action: "create",
        actorId: me.id,
        now: deps.now(),
        key,
        input,
      });
      c.header("X-Group-Rev", String(result.rev));
      return c.json(result.value, 201);
    })
    .post("/settlements/:sid/undo", signedIn, limited, async (c) => {
      const db = createDb(c.env.DB);
      const groupId = await resolveSettlementGroup(
        db,
        c.req.param("sid"),
        c.var.userId,
        c.env,
        deps.now(),
      );
      const me = await requireMember(db, groupId, c.var.userId);
      const result = await groupLedger(c.env, groupId).settlement({
        action: "undo",
        actorId: me.id,
        now: deps.now(),
        id: c.req.param("sid"),
      });
      c.header("X-Group-Rev", String(result.rev));
      return c.json(result.value, 200);
    });
}
