/**
 * D1 schema (Release 2): Retained tables and read models for the Group Ledger architecture.
 * Legacy tables (groups, members, expenses, expense_payers, expense_splits, settlements, stops)
 * have been dropped in migration 0008. Group authority lives exclusively in GroupLedger Durable Objects.
 */
import {
  CURRENCY_CODES,
  LANGUAGES,
  MEMBER_ROLES,
  MEMBER_STATUSES,
  PROVIDERS,
  SETTLEMENT_STATUSES,
} from "@split/shared";
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

export { MEMBER_ROLES, MEMBER_STATUSES, PROVIDERS, SETTLEMENT_STATUSES };
export const SPLIT_TYPES = ["equal", "exact", "shares"] as const;

/** `column IN ('a', 'b')` for a fixed list of literals. */
function oneOf(column: AnySQLiteColumn, values: readonly string[]): SQL {
  return sql`${column} IN (${sql.raw(values.map((v) => `'${v}'`).join(", "))})`;
}

const currency = (name: string) => text(name, { enum: CURRENCY_CODES });

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    pictureUrl: text("picture_url"),
    /** The provider of the latest sign-in, whose name and picture the profile shows. */
    lastProvider: text("last_provider", { enum: PROVIDERS }),
    preferredCurrency: currency("preferred_currency").notNull().default("TWD"),
    language: text("language", { enum: LANGUAGES }).notNull().default("zh-TW"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    check("users_preferred_currency_check", oneOf(t.preferredCurrency, CURRENCY_CODES)),
    check("users_language_check", oneOf(t.language, LANGUAGES)),
  ],
);

export const identities = sqliteTable(
  "identities",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: PROVIDERS }).notNull(),
    providerSub: text("provider_sub").notNull(),
    /** Only Google shares a verified email; LINE never does. */
    email: text("email"),
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

/** One-time code that lets a signed-in User attach a Google Identity from an outside browser. */
export const linkCodes = sqliteTable("link_codes", {
  codeHash: text("code_hash").primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
});

/** Invite token lookup (retained). */
export const invites = sqliteTable("invites", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull(),
  token: text("token").notNull().unique(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
});

/** Durable Settlement ID to Group lookup (retained). */
export const settlementRoutes = sqliteTable(
  "settlement_routes",
  {
    settlementId: text("settlement_id").primaryKey(),
    groupId: text("group_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("settlement_routes_group_id_idx").on(t.groupId)],
);

/** Reference exchange rates. */
export const fxRates = sqliteTable(
  "fx_rates",
  {
    rateDate: text("rate_date").notNull(),
    baseCurrency: currency("base_currency").notNull(),
    quoteCurrency: currency("quote_currency").notNull(),
    rateScaled: integer("rate_scaled").notNull(),
    publishedDate: text("published_date"),
    fetchedAt: integer("fetched_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.rateDate, t.baseCurrency, t.quoteCurrency] }),
    check("fx_rates_rate_check", sql`${t.rateScaled} > 0`),
  ],
);

/** Per-User write counters behind signed-in rate limits (decision 27). */
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

/** Group Directory read model (decision 16). */
export const groupDirectory = sqliteTable("group_directory", {
  groupId: text("group_id").primaryKey(),
  name: text("name").notNull(),
  settlementCurrency: text("settlement_currency", { enum: CURRENCY_CODES }).notNull(),
  isTrip: integer("is_trip").notNull().default(0),
  tripDestination: text("trip_destination"),
  tripStartDate: text("trip_start_date"),
  tripEndDate: text("trip_end_date"),
  tripNotes: text("trip_notes"),
  settlementCurrencyLocked: integer("settlement_currency_locked").notNull().default(0),
  memberCount: integer("member_count").notNull().default(1),
  memberPreview: text("member_preview").notNull().default("[]"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  rev: integer("rev").notNull().default(0),
  deleted: integer("deleted").notNull().default(0),
});

/** Group Member Summary read model (decision 16). */
export const groupMemberSummary = sqliteTable(
  "group_member_summary",
  {
    userId: text("user_id").notNull(),
    groupId: text("group_id").notNull(),
    memberId: text("member_id").notNull(),
    role: text("role", { enum: MEMBER_ROLES }).notNull(),
    netBalance: integer("net_balance").notNull().default(0),
    rev: integer("rev").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.groupId] })],
);

/** Group Reservations for membership reservation & account deletion guard (decision 16). */
export const groupReservations = sqliteTable(
  "group_reservations",
  {
    userId: text("user_id").notNull(),
    groupId: text("group_id").notNull(),
    status: text("status", { enum: ["pending", "active"] }).notNull().default("pending"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.groupId] })],
);

/** Personal Spending read model (decision 16). */
export const personalSpending = sqliteTable(
  "personal_spending",
  {
    groupId: text("group_id").notNull(),
    expenseId: text("expense_id").notNull(),
    userId: text("user_id").notNull(),
    description: text("description").notNull(),
    expenseDate: text("expense_date").notNull(),
    category: text("category").notNull(),
    currency: text("currency", { enum: CURRENCY_CODES }).notNull(),
    amount: integer("amount").notNull(),
    rev: integer("rev").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.expenseId, t.userId] }),
    index("personal_spending_user_date_idx").on(t.userId, t.expenseDate),
  ],
);
