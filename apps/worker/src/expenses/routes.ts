import { expenseInputSchema } from "@split/shared";
import { z } from "zod";
import { and, desc, eq, gt, gte, lt, lte, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { AppEnv } from "../api.js";
import { requireUser } from "../auth/require-user.js";
import { createDb } from "../db/client.js";
import type { AppDeps } from "../deps.js";
import { ApiError } from "../errors.js";
import { requireMember } from "../groups/membership.js";
import { expenseLedgerOperation } from "../groups/ledger-client.js";
import { fxRates } from "../db/schema.js";
import { rateLimit } from "../rate-limit.js";
import { parseBody, requireIdempotencyKey, requireIfMatch } from "../request-guards.js";
import { personalSpending } from "./personal-spending.js";
import { groupBalances } from "./expenses.js";

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
      const spending = personalSpending(db, c.var.userId);
      const month = sql<string>`substr(${spending.date}, 1, 7)`;
      const rows = await db
        .select({
          month,
          category: spending.category,
          currency: spending.currency,
          amount: sql<number>`sum(${spending.amount})`,
        })
        .from(spending)
        .where(
          and(
            from === undefined ? undefined : gte(spending.date, `${from}-01`),
            to === undefined ? undefined : lte(spending.date, `${to}-31`),
          ),
        )
        .groupBy(month, sql`${spending.category}`, sql`${spending.currency}`);
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
      const spending = personalSpending(db, c.var.userId);
      const rows = await db
        .select({
          id: spending.expenseId,
          groupId: spending.groupId,
          groupName: spending.groupName,
          description: spending.description,
          date: spending.date,
          currency: spending.currency,
          amount: spending.amount,
        })
        .from(spending)
        .where(
          and(
            gt(spending.amount, 0),
            gte(spending.date, `${month}-01`),
            lte(spending.date, `${month}-31`),
            eq(spending.category, category),
            cursor === undefined ? undefined : lt(spending.expenseId, cursor),
          ),
        )
        .orderBy(desc(spending.expenseId))
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
      return c.json(
        await expenseLedgerOperation(c.env, me.groupId, {
          action: "list",
          actorMemberId: me.id,
          cursor: c.req.query("cursor"),
        }),
        200,
      );
    })
    .post("/groups/:id/expenses", signedIn, limited, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      const key = requireIdempotencyKey(c);
      const input = await parseBody(c, expenseInputSchema);
      const rates = await db.select().from(fxRates).where(eq(fxRates.rateDate, input.fxDate));
      const result = await expenseLedgerOperation(
        c.env,
        me.groupId,
        {
          action: "create",
          actorMemberId: me.id,
          memberId: me.id,
          input,
          key,
          now: deps.now(),
          rates: rates.map((r) => ({
            base: r.baseCurrency,
            quote: r.quoteCurrency,
            rate: r.rateScaled,
          })),
        },
        (rev) => {
          c.header("X-Group-Rev", rev);
        },
      );
      return c.json(result, 201);
    })
    .get("/groups/:id/expenses/:eid", signedIn, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      return c.json(
        await expenseLedgerOperation(c.env, me.groupId, {
          action: "get",
          id: c.req.param("eid"),
          actorMemberId: me.id,
        }),
        200,
      );
    })
    .patch("/groups/:id/expenses/:eid", signedIn, limited, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      const expected = requireIfMatch(c);
      const input = await parseBody(c, expenseInputSchema);
      const rates = await db.select().from(fxRates).where(eq(fxRates.rateDate, input.fxDate));
      const updated = await expenseLedgerOperation(
        c.env,
        me.groupId,
        {
          action: "update",
          actorMemberId: me.id,
          id: c.req.param("eid"),
          memberId: me.id,
          input,
          expected,
          now: deps.now(),
          rates: rates.map((r) => ({
            base: r.baseCurrency,
            quote: r.quoteCurrency,
            rate: r.rateScaled,
          })),
        },
        (rev) => {
          c.header("X-Group-Rev", rev);
        },
      );
      return c.json(updated, 200);
    })
    .delete("/groups/:id/expenses/:eid", signedIn, limited, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      await expenseLedgerOperation(
        c.env,
        me.groupId,
        {
          action: "delete",
          actorMemberId: me.id,
          id: c.req.param("eid"),
          now: deps.now(),
        },
        (rev) => {
          c.header("X-Group-Rev", rev);
        },
      );
      return c.body(null, 204);
    })
    .get("/groups/:id/balances", signedIn, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      const result = await groupBalances(db, me);
      const balances = z
        .array(z.object({ id: z.string(), net_balance: z.number() }))
        .parse(
          await expenseLedgerOperation(c.env, me.groupId, {
            action: "balances",
            actorMemberId: me.id,
          }),
        );
      const byId = new Map(balances.map((m) => [m.id, m.net_balance]));
      return c.json(
        {
          ...result,
          balances: result.balances.map((m) => ({
            ...m,
            balance: byId.get(m.memberId) ?? m.balance,
          })),
        },
        200,
      );
    });
}
