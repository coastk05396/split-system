import { settlementConfirmSchema, settlementInputSchema } from "@split/shared";
import { eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import type { AppEnv } from "../api.js";
import { requireUser } from "../auth/require-user.js";
import { createDb } from "../db/client.js";
import { settlements } from "../db/schema.js";
import type { AppDeps } from "../deps.js";
import { ApiError } from "../errors.js";
import type { Bindings } from "../env.js";
import { requireMember } from "../groups/membership.js";
import { rateLimit } from "../rate-limit.js";
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
      const db = createDb(c.env.DB),
        row = (
          await db
            .select({ groupId: settlements.groupId })
            .from(settlements)
            .where(eq(settlements.id, c.req.param("sid")))
        )[0];
      if (row === undefined) throw new ApiError("NOT_FOUND");
      const me = await requireMember(db, row.groupId, c.var.userId);
      const body = hasJsonBody(c) ? await parseBody(c, settlementConfirmSchema) : {};
      return callLedger(c.env, row.groupId, {
        action: "confirm",
        actorId: me.id,
        now: deps.now(),
        id: c.req.param("sid"),
        ...body,
      });
    })
    .post("/settlements/:sid/cancel", signedIn, limited, async (c) => {
      const db = createDb(c.env.DB),
        row = (
          await db
            .select({ groupId: settlements.groupId })
            .from(settlements)
            .where(eq(settlements.id, c.req.param("sid")))
        )[0];
      if (row === undefined) throw new ApiError("NOT_FOUND");
      const me = await requireMember(db, row.groupId, c.var.userId);
      return callLedger(c.env, row.groupId, {
        action: "cancel",
        actorId: me.id,
        now: deps.now(),
        id: c.req.param("sid"),
      });
    })
    .post("/settlements/:sid/undo", signedIn, limited, async (c) => {
      const db = createDb(c.env.DB),
        row = (
          await db
            .select({ groupId: settlements.groupId })
            .from(settlements)
            .where(eq(settlements.id, c.req.param("sid")))
        )[0];
      if (row === undefined) throw new ApiError("NOT_FOUND");
      const me = await requireMember(db, row.groupId, c.var.userId);
      return callLedger(c.env, row.groupId, {
        action: "undo",
        actorId: me.id,
        now: deps.now(),
        id: c.req.param("sid"),
      });
    });
}
