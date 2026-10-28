/**
 * D1 schema: the tables of SPEC §4, plus the indexes and checks of decisions 15, 23, 27
 * and 31. Moments are UTC milliseconds; dates and times are local text; money is an
 * integer in the currency's smallest unit; exchange rates are scaled by 1,000,000.
 */
import { CURRENCY_CODES, MAX_AMOUNT_MINOR, MIN_AMOUNT_MINOR, PROVIDERS } from "@split/shared";
import { type SQL, sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export { PROVIDERS };
export const MEMBER_ROLES = ["admin", "member"] as const;
export const MEMBER_STATUSES = ["active", "former", "placeholder"] as const;
export const SPLIT_TYPES = ["equal", "exact", "shares"] as const;
export const SETTLEMENT_STATUSES = ["pending", "confirmed", "cancelled", "undone"] as const;

/** `column IN ('a', 'b')` for a fixed list of literals. */
function oneOf(column: AnySQLiteColumn, values: readonly string[]): SQL {
  return sql`${column} IN (${sql.raw(values.map((v) => `'${v}'`).join(", "))})`;
}

const isFlag = (column: AnySQLiteColumn): SQL => sql`${column} IN (0, 1)`;
const currency = (name: string) => text(name, { enum: CURRENCY_CODES });

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  pictureUrl: text("picture_url"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const identities = sqliteTable(
  "identities",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: PROVIDERS }).notNull(),
    providerSub: text("provider_sub").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("identities_provider_sub_unique").on(t.provider, t.providerSub),
    check("identities_provider_check", oneOf(t.provider, PROVIDERS)),
  ],
);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  refreshTokenHash: text("refresh_token_hash").notNull().unique(),
  userAgent: text("user_agent"),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const groups = sqliteTable(
  "groups",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    settlementCurrency: currency("settlement_currency").notNull().default("TWD"),
    defaultExpenseCurrency: currency("default_expense_currency").notNull().default("TWD"),
    isTrip: integer("is_trip", { mode: "boolean" }).notNull().default(false),
    tripDestination: text("trip_destination"),
    tripStartDate: text("trip_start_date"),
    tripEndDate: text("trip_end_date"),
    tripNotes: text("trip_notes"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    check("groups_settlement_currency_check", oneOf(t.settlementCurrency, CURRENCY_CODES)),
    check("groups_default_expense_currency_check", oneOf(t.defaultExpenseCurrency, CURRENCY_CODES)),
    check("groups_is_trip_check", isFlag(t.isTrip)),
    check(
      "groups_trip_dates_check",
      sql`${t.tripStartDate} IS NULL OR ${t.tripEndDate} IS NULL OR ${t.tripEndDate} >= ${t.tripStartDate}`,
    ),
  ],
);

export const members = sqliteTable(
  "members",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    /** Null for a placeholder, and for a Former Member whose account was deleted. */
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    placeholderName: text("placeholder_name"),
    nickname: text("nickname"),
    role: text("role", { enum: MEMBER_ROLES }).notNull().default("member"),
    status: text("status", { enum: MEMBER_STATUSES }).notNull().default("active"),
    /** Balance snapshot in the Group's Settlement currency. */
    netBalance: integer("net_balance").notNull().default(0),
    createdByMemberId: text("created_by_member_id").references((): AnySQLiteColumn => members.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    // Also serves lookups by group_id (decision 15's member(group_id) index), so no second index.
    uniqueIndex("members_group_user_unique").on(t.groupId, t.userId),
    check("members_role_check", oneOf(t.role, MEMBER_ROLES)),
    check("members_status_check", oneOf(t.status, MEMBER_STATUSES)),
    check(
      "members_placeholder_check",
      sql`${t.status} <> 'placeholder' OR (${t.userId} IS NULL AND ${t.placeholderName} IS NOT NULL)`,
    ),
    check("members_active_user_check", sql`${t.status} <> 'active' OR ${t.userId} IS NOT NULL`),
  ],
);

export const invites = sqliteTable("invites", {
  id: text("id").primaryKey(),
  groupId: text("group_id")
    .notNull()
    .references(() => groups.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const expenses = sqliteTable(
  "expenses",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    creatorMemberId: text("creator_member_id")
      .notNull()
      .references(() => members.id),
    description: text("description").notNull(),
    category: text("category").notNull(),
    originalAmount: integer("original_amount").notNull(),
    originalCurrency: currency("original_currency").notNull(),
    fxRateScaled: integer("fx_rate_scaled").notNull(),
    fxDate: text("fx_date").notNull(),
    isCustomRate: integer("is_custom_rate", { mode: "boolean" }).notNull().default(false),
    settlementAmount: integer("settlement_amount").notNull(),
    splitType: text("split_type", { enum: SPLIT_TYPES }).notNull(),
    expenseDate: text("expense_date").notNull(),
    expenseTime: text("expense_time"),
    stopId: text("stop_id").references((): AnySQLiteColumn => stops.id, { onDelete: "set null" }),
    receiptKey: text("receipt_key"),
    idempotencyKey: text("idempotency_key").unique(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("expenses_group_date_idx").on(t.groupId, t.expenseDate),
    check(
      "expenses_original_amount_check",
      sql`${t.originalAmount} BETWEEN ${sql.raw(String(MIN_AMOUNT_MINOR))} AND ${sql.raw(String(MAX_AMOUNT_MINOR))}`,
    ),
    check("expenses_original_currency_check", oneOf(t.originalCurrency, CURRENCY_CODES)),
    check("expenses_fx_rate_check", sql`${t.fxRateScaled} > 0`),
    check("expenses_is_custom_rate_check", isFlag(t.isCustomRate)),
    check("expenses_settlement_amount_check", sql`${t.settlementAmount} >= 0`),
    check("expenses_split_type_check", oneOf(t.splitType, SPLIT_TYPES)),
  ],
);

export const expensePayers = sqliteTable(
  "expense_payers",
  {
    id: text("id").primaryKey(),
    expenseId: text("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
    /** In the Expense currency. */
    amount: integer("amount").notNull(),
    settlementAmount: integer("settlement_amount").notNull(),
  },
  (t) => [
    uniqueIndex("expense_payers_expense_member_unique").on(t.expenseId, t.memberId),
    check("expense_payers_amount_check", sql`${t.amount} > 0`),
    check("expense_payers_settlement_amount_check", sql`${t.settlementAmount} >= 0`),
  ],
);

export const expenseSplits = sqliteTable(
  "expense_splits",
  {
    id: text("id").primaryKey(),
    expenseId: text("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
    shareUnits: integer("share_units").notNull().default(1),
    settlementAmount: integer("settlement_amount").notNull(),
  },
  (t) => [
    uniqueIndex("expense_splits_expense_member_unique").on(t.expenseId, t.memberId),
    check("expense_splits_share_units_check", sql`${t.shareUnits} BETWEEN 1 AND 99`),
    check("expense_splits_settlement_amount_check", sql`${t.settlementAmount} >= 0`),
  ],
);

export const settlements = sqliteTable(
  "settlements",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    payerMemberId: text("payer_member_id")
      .notNull()
      .references(() => members.id),
    receiverMemberId: text("receiver_member_id")
      .notNull()
      .references(() => members.id),
    /** In the Group's Settlement currency. */
    amount: integer("amount").notNull(),
    status: text("status", { enum: SETTLEMENT_STATUSES }).notNull().default("confirmed"),
    confirmedAt: integer("confirmed_at"),
    idempotencyKey: text("idempotency_key").unique(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("settlements_group_created_idx").on(t.groupId, t.createdAt),
    check("settlements_amount_check", sql`${t.amount} > 0`),
    check("settlements_distinct_members_check", sql`${t.payerMemberId} <> ${t.receiverMemberId}`),
    check("settlements_status_check", oneOf(t.status, SETTLEMENT_STATUSES)),
  ],
);

export const stops = sqliteTable(
  "stops",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    dayDate: text("day_date").notNull(),
    startTime: text("start_time"),
    endTime: text("end_time"),
    title: text("title").notNull(),
    category: text("category").notNull(),
    locationName: text("location_name"),
    notes: text("notes"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("stops_group_day_idx").on(t.groupId, t.dayDate),
    check(
      "stops_time_order_check",
      sql`${t.startTime} IS NULL OR ${t.endTime} IS NULL OR ${t.endTime} >= ${t.startTime}`,
    ),
  ],
);

export const fxRates = sqliteTable(
  "fx_rates",
  {
    rateDate: text("rate_date").notNull(),
    baseCurrency: currency("base_currency").notNull(),
    quoteCurrency: currency("quote_currency").notNull(),
    rateScaled: integer("rate_scaled").notNull(),
    fetchedAt: integer("fetched_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.rateDate, t.baseCurrency, t.quoteCurrency] }),
    check("fx_rates_rate_check", sql`${t.rateScaled} > 0`),
  ],
);

/** Per-User write counters behind the signed-in rate limits (decision 27). */
export const rateCounters = sqliteTable(
  "rate_counters",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    routeGroup: text("route_group").notNull(),
    windowStart: integer("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.routeGroup, t.windowStart] })],
);
