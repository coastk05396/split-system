import { expenseInputSchema } from "@split/shared";
import { and, desc, eq, gt, gte, lt, lte, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { AppEnv } from "../api.js";
import { requireUser } from "../auth/require-user.js";
import { createDb } from "../db/client.js";
import { expenseSplits, expenses, groups, members } from "../db/schema.js";
import type { AppDeps } from "../deps.js";
import { ApiError } from "../errors.js";
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
    .get("/stats/spending", signedIn, async (c) => {
      const from = c.req.query("from");
      const to = c.req.query("to");
      const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
      if (
        (from === undefined) !== (to === undefined) ||
        (from !== undefined &&
          to !== undefined &&
          (!monthPattern.test(from) || !monthPattern.test(to) || from > to))
      )
        throw new ApiError("VALIDATION_FAILED");
      const db = createDb(c.env.DB);
      const month = sql<string>`substr(${expenses.expenseDate}, 1, 7)`;
      const rows = await db
        .select({
          month,
          category: expenses.category,
          currency: groups.settlementCurrency,
          amount: sql<number>`sum(${expenseSplits.settlementAmount})`,
        })
        .from(members)
        .innerJoin(groups, eq(groups.id, members.groupId))
        .innerJoin(expenses, eq(expenses.groupId, groups.id))
        .innerJoin(
          expenseSplits,
          and(eq(expenseSplits.expenseId, expenses.id), eq(expenseSplits.memberId, members.id)),
        )
        .where(
          and(
            eq(members.userId, c.var.userId),
            eq(members.status, "active"),
            from === undefined ? undefined : gte(expenses.expenseDate, `${from}-01`),
            to === undefined ? undefined : lte(expenses.expenseDate, `${to}-31`),
          ),
        )
        .groupBy(month, expenses.category, groups.settlementCurrency);
      return c.json(rows, 200);
    })
    .get("/stats/expenses", signedIn, async (c) => {
      const month = c.req.query("month");
      const category = c.req.query("category");
      const cursor = c.req.query("cursor");
      if (
        month === undefined ||
        !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
        category === undefined ||
        (cursor !== undefined && cursor.length > 128)
      )
        throw new ApiError("VALIDATION_FAILED");
      const db = createDb(c.env.DB);
      const rows = await db
        .select({
          id: expenses.id,
          groupId: groups.id,
          groupName: groups.name,
          description: expenses.description,
          date: expenses.expenseDate,
          currency: groups.settlementCurrency,
          amount: expenseSplits.settlementAmount,
        })
        .from(members)
        .innerJoin(groups, eq(groups.id, members.groupId))
        .innerJoin(expenses, eq(expenses.groupId, groups.id))
        .innerJoin(
          expenseSplits,
          and(eq(expenseSplits.expenseId, expenses.id), eq(expenseSplits.memberId, members.id)),
        )
        .where(
          and(
            eq(members.userId, c.var.userId),
            eq(members.status, "active"),
            gt(expenseSplits.settlementAmount, 0),
            gte(expenses.expenseDate, `${month}-01`),
            lte(expenses.expenseDate, `${month}-31`),
            eq(expenses.category, category),
            cursor === undefined ? undefined : lt(expenses.id, cursor),
          ),
        )
        .orderBy(desc(expenses.id))
        .limit(51);
      const items = rows.slice(0, 50);
      return c.json(
        { items, nextCursor: rows.length > 50 ? (items.at(-1)?.id ?? null) : null },
        200,
      );
    })
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
