import type { CurrencyCode } from "@split/shared";
import { and, eq, sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { Db } from "../db/client.js";

const spending = sqliteTable("personal_spending", {
  expenseId: text("expense_id").notNull(),
  groupId: text("group_id").notNull(),
  userId: text("user_id").notNull(),
  description: text("description").notNull(),
  date: text("expense_date").notNull(),
  category: text("category").notNull(),
  currency: text("currency").$type<CurrencyCode>().notNull(),
  amount: integer("amount").notNull(),
});
const directory = sqliteTable("group_directory", {
  groupId: text("group_id").notNull(),
  name: text("name"),
  deleted: integer("deleted").notNull(),
});

export function personalSpending(db: Db, userId: string) {
  return db
    .select({
      expenseId: sql<string>`${spending.expenseId}`.as("expense_id"),
      groupId: sql<string>`${spending.groupId}`.as("group_id"),
      groupName: sql<string>`${directory.name}`.as("group_name"),
      description: sql<string>`${spending.description}`.as("description"),
      date: sql<string>`${spending.date}`.as("expense_date"),
      category: sql<string>`${spending.category}`.as("category"),
      currency: sql<CurrencyCode>`${spending.currency}`.as("currency"),
      amount: sql<number>`${spending.amount}`.as("amount"),
    })
    .from(spending)
    .innerJoin(directory, eq(spending.groupId, directory.groupId))
    .where(and(eq(spending.userId, userId), eq(directory.deleted, 0)))
    .as("personal_spending");
}
