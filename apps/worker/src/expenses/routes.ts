import { expenseInputSchema } from "@split/shared";
import { Hono } from "hono";
import type { AppEnv } from "../api.js";
import { requireUser } from "../auth/require-user.js";
import { createDb } from "../db/client.js";
import type { AppDeps } from "../deps.js";
import { requireMember } from "../groups/membership.js";
import { rateLimit } from "../rate-limit.js";
import { parseBody, requireIdempotencyKey, requireIfMatch } from "../request-guards.js";
import {
  createExpense,
  deleteExpense,
  getExpense,
  groupBalances,
  listExpenses,
  updateExpense,
} from "./expenses.js";

/** Expenses and Balances (SPEC §5.1, decisions 15, 16, 23). Any active Member may write. */
export function expenseRoutes(deps: AppDeps) {
  const signedIn = requireUser(deps.now);
  const limited = rateLimit("expense_write", deps.now);

  return new Hono<AppEnv>()
    .get("/groups/:id/expenses", signedIn, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      return c.json(await listExpenses(db, me, c.req.query("cursor")), 200);
    })
    .post("/groups/:id/expenses", signedIn, limited, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      const key = requireIdempotencyKey(c);
      const input = await parseBody(c, expenseInputSchema);
      return c.json(await createExpense(db, me, input, key, deps.now()), 201);
    })
    .get("/groups/:id/expenses/:eid", signedIn, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      return c.json(await getExpense(db, me, c.req.param("eid")), 200);
    })
    .patch("/groups/:id/expenses/:eid", signedIn, limited, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      const expected = requireIfMatch(c);
      const input = await parseBody(c, expenseInputSchema);
      const updated = await updateExpense(db, me, c.req.param("eid"), input, expected, deps.now());
      return c.json(updated, 200);
    })
    .delete("/groups/:id/expenses/:eid", signedIn, limited, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      await deleteExpense(db, me, c.req.param("eid"));
      return c.body(null, 204);
    })
    .get("/groups/:id/balances", signedIn, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      return c.json(await groupBalances(db, me), 200);
    });
}
