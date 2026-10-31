import type { CurrencyCode } from "@split/shared";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { expenseSplits, expenses, groups, members } from "../db/schema.js";

/** The current User's Expense allocations in Groups they can still access. */
export function personalSpending(db: Db, userId: string) {
  return db
    .select({
      expenseId: sql<string>`${expenses.id}`.as("expense_id"),
      groupId: sql<string>`${groups.id}`.as("group_id"),
      groupName: sql<string>`${groups.name}`.as("group_name"),
      description: sql<string>`${expenses.description}`.as("description"),
      date: sql<string>`${expenses.expenseDate}`.as("expense_date"),
      category: sql<string>`${expenses.category}`.as("category"),
      currency: sql<CurrencyCode>`${groups.settlementCurrency}`.as("currency"),
      amount: sql<number>`${expenseSplits.settlementAmount}`.as("amount"),
    })
    .from(members)
    .innerJoin(groups, eq(groups.id, members.groupId))
    .innerJoin(expenses, eq(expenses.groupId, groups.id))
    .innerJoin(
      expenseSplits,
      and(eq(expenseSplits.expenseId, expenses.id), eq(expenseSplits.memberId, members.id)),
    )
    .where(and(eq(members.userId, userId), eq(members.status, "active")))
    .as("personal_spending");
}
