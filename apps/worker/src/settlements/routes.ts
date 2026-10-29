import { settlementConfirmSchema, settlementInputSchema } from "@split/shared";
import { type Context, Hono } from "hono";
import type { AppEnv } from "../api.js";
import { requireUser } from "../auth/require-user.js";
import { createDb } from "../db/client.js";
import type { AppDeps } from "../deps.js";
import { requireMember } from "../groups/membership.js";
import { rateLimit } from "../rate-limit.js";
import { parseBody, requireIdempotencyKey } from "../request-guards.js";
import {
  cancelSettlement,
  confirmSettlement,
  createSettlement,
  listSettlements,
  undoSettlement,
} from "./settlements.js";

/** The confirm body is optional: a request without a JSON body confirms the recorded amount. */
function hasJsonBody(c: Context): boolean {
  return c.req.header("Content-Type")?.includes("application/json") === true;
}

/**
 * Settlements (SPEC §5.1, decisions 12, 16, 23). Writes share the Expense write limit, since
 * decision 27 counts "Expense or Settlement create or edit" together.
 */
export function settlementRoutes(deps: AppDeps) {
  const signedIn = requireUser(deps.now);
  const limited = rateLimit("expense_write", deps.now);

  return new Hono<AppEnv>()
    .get("/groups/:id/settlements", signedIn, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      return c.json(await listSettlements(db, me, c.req.query("cursor")), 200);
    })
    .post("/groups/:id/settlements", signedIn, limited, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      const key = requireIdempotencyKey(c);
      const input = await parseBody(c, settlementInputSchema);
      return c.json(await createSettlement(db, me, input, key, deps.now()), 201);
    })
    .post("/settlements/:sid/confirm", signedIn, limited, async (c) => {
      const db = createDb(c.env.DB);
      const body = hasJsonBody(c) ? await parseBody(c, settlementConfirmSchema) : {};
      const confirmed = await confirmSettlement(
        db,
        c.var.userId,
        c.req.param("sid"),
        body.amount,
        deps.now(),
      );
      return c.json(confirmed, 200);
    })
    .post("/settlements/:sid/cancel", signedIn, limited, async (c) => {
      const db = createDb(c.env.DB);
      return c.json(await cancelSettlement(db, c.var.userId, c.req.param("sid"), deps.now()), 200);
    })
    .post("/settlements/:sid/undo", signedIn, limited, async (c) => {
      const db = createDb(c.env.DB);
      return c.json(await undoSettlement(db, c.var.userId, c.req.param("sid"), deps.now()), 200);
    });
}
