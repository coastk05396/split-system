import { MAX_GROUPS_PER_USER, settlementConfirmSchema, settlementInputSchema } from "@split/shared";
import { and, eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import type { AppEnv } from "../api.js";
import { requireUser } from "../auth/require-user.js";
import { createDb, type Db } from "../db/client.js";
import { groupReservations, settlementRoutes as settlementRoutesTable } from "../db/schema.js";
import type { AppDeps } from "../deps.js";
import { ApiError } from "../errors.js";
import type { Bindings } from "../env.js";
import { requireMember } from "../groups/membership.js";
import { consumeRateLimit, rateLimit } from "../rate-limit.js";
import { parseBody, requireIdempotencyKey } from "../request-guards.js";

function hasJsonBody(c: Context): boolean {
  return c.req.header("Content-Type")?.includes("application/json") === true;
}

async function callLedger(
  env: Bindings,
  groupId: string,
  payload: object,
  successStatus = 200,
): Promise<Response> {
  const stub = env.GROUP_LEDGER.get(env.GROUP_LEDGER.idFromName(groupId));
  const response = await stub.fetch("https://ledger.internal/settlement-op", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return new Response(response.body, {
    status: response.ok ? successStatus : response.status,
    headers: response.headers,
  });
}

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
      .where(
        and(
          eq(groupReservations.userId, userId),
          eq(groupReservations.status, "active"),
        ),
      );
  } catch {
    throw new ApiError("SERVICE_UNAVAILABLE");
  }

  const candidateGroups = userReservations.slice(0, MAX_GROUPS_PER_USER);

  for (const { groupId } of candidateGroups) {
    try {
      const resp = await env.GROUP_LEDGER.get(env.GROUP_LEDGER.idFromName(groupId)).fetch(
        `https://ledger.internal/settlement-check?id=${encodeURIComponent(sid)}`,
        { headers: { "X-User-Id": userId } },
      );
      if (resp.ok) {
        const data = await resp.json<{ found: boolean }>();
        if (data.found) {
          return groupId;
        }
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
      return callLedger(c.env, me.groupId, {
        action: "list",
        actorId: me.id,
        now: deps.now(),
        cursor: c.req.query("cursor"),
      });
    })
    .post("/groups/:id/settlements", signedIn, limited, async (c) => {
      const me = await requireMember(createDb(c.env.DB), c.req.param("id"), c.var.userId);
      const key = requireIdempotencyKey(c),
        input = await parseBody(c, settlementInputSchema);
      return callLedger(
        c.env,
        me.groupId,
        { action: "create", actorId: me.id, now: deps.now(), key, input },
        201,
      );
    })
    .post("/settlements/:sid/confirm", signedIn, limited, async (c) => {
      const db = createDb(c.env.DB);
      const groupId = await resolveSettlementGroup(db, c.req.param("sid"), c.var.userId, c.env, deps.now());
      const me = await requireMember(db, groupId, c.var.userId);
      const body = hasJsonBody(c) ? await parseBody(c, settlementConfirmSchema) : {};
      return callLedger(c.env, groupId, {
        action: "confirm",
        actorId: me.id,
        now: deps.now(),
        id: c.req.param("sid"),
        ...body,
      });
    })
    .post("/settlements/:sid/cancel", signedIn, limited, async (c) => {
      const db = createDb(c.env.DB);
      const groupId = await resolveSettlementGroup(db, c.req.param("sid"), c.var.userId, c.env, deps.now());
      const me = await requireMember(db, groupId, c.var.userId);
      return callLedger(c.env, groupId, {
        action: "cancel",
        actorId: me.id,
        now: deps.now(),
        id: c.req.param("sid"),
      });
    })
    .post("/settlements/:sid/undo", signedIn, limited, async (c) => {
      const db = createDb(c.env.DB);
      const groupId = await resolveSettlementGroup(db, c.req.param("sid"), c.var.userId, c.env, deps.now());
      const me = await requireMember(db, groupId, c.var.userId);
      return callLedger(c.env, groupId, {
        action: "undo",
        actorId: me.id,
        now: deps.now(),
        id: c.req.param("sid"),
      });
    });
}
