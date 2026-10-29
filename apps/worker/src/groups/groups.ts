import {
  type Group,
  type GroupInput,
  type GroupPatch,
  MAX_GROUPS_PER_USER,
  tripDatesValid,
} from "@split/shared";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { groups, members, users } from "../db/schema.js";
import { ApiError } from "../errors.js";
import { type MemberRow, requireAdmin } from "./membership.js";

type GroupRow = typeof groups.$inferSelect;

// Correlated subqueries name the outer `groups` table in full: Drizzle leaves column
// references unqualified in a one-table select, which would bind to the inner table.
const lockedSql = sql<number>`EXISTS (SELECT 1 FROM expenses e WHERE e.group_id = "groups"."id")`;
const seatedSql = sql<number>`(SELECT count(*) FROM members s WHERE s.group_id = "groups"."id" AND s.status IN ('active', 'placeholder'))`;

const PREVIEW_SIZE = 4;

/** The first few seated Members of each Group, in joining order, for the card's avatars. */
async function previewsOf(db: Db, groupIds: readonly string[]) {
  const byGroup = new Map<string, Group["memberPreview"]>();
  if (groupIds.length === 0) return byGroup;
  const rows = await db
    .select({
      groupId: members.groupId,
      userName: users.displayName,
      placeholderName: members.placeholderName,
      pictureUrl: users.pictureUrl,
      status: members.status,
    })
    .from(members)
    .leftJoin(users, eq(users.id, members.userId))
    .where(
      and(
        inArray(members.groupId, [...groupIds]),
        inArray(members.status, ["active", "placeholder"]),
      ),
    )
    .orderBy(asc(members.createdAt), sql`${members}.rowid`);
  for (const r of rows) {
    const list = byGroup.get(r.groupId) ?? [];
    if (list.length >= PREVIEW_SIZE) continue;
    list.push({
      name: r.userName ?? r.placeholderName ?? "?",
      pictureUrl: r.status === "placeholder" ? null : r.pictureUrl,
    });
    byGroup.set(r.groupId, list);
  }
  return byGroup;
}

function toGroup(
  row: GroupRow,
  me: MemberRow,
  locked: number,
  memberCount: number,
  memberPreview: Group["memberPreview"],
): Group {
  return {
    id: row.id,
    name: row.name,
    settlementCurrency: row.settlementCurrency,
    isTrip: row.isTrip,
    tripDestination: row.tripDestination,
    tripStartDate: row.tripStartDate,
    tripEndDate: row.tripEndDate,
    tripNotes: row.tripNotes,
    settlementCurrencyLocked: locked === 1,
    memberCount,
    memberPreview,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    me: { memberId: me.id, role: me.role, balance: me.netBalance },
  };
}

/** The Groups the User is an active Member of, newest first. */
export async function listGroups(db: Db, userId: string): Promise<Group[]> {
  const rows = await db
    .select({ group: groups, me: members, locked: lockedSql, memberCount: seatedSql })
    .from(members)
    .innerJoin(groups, eq(groups.id, members.groupId))
    .where(and(eq(members.userId, userId), eq(members.status, "active")))
    .orderBy(desc(groups.createdAt), desc(groups.id));
  const previews = await previewsOf(
    db,
    rows.map((r) => r.group.id),
  );
  return rows.map((r) =>
    toGroup(r.group, r.me, r.locked, r.memberCount, previews.get(r.group.id) ?? []),
  );
}

export async function loadGroup(db: Db, me: MemberRow): Promise<Group> {
  const [row] = await db
    .select({ group: groups, locked: lockedSql, memberCount: seatedSql })
    .from(groups)
    .where(eq(groups.id, me.groupId));
  if (row === undefined) throw new ApiError("NOT_FOUND");
  const previews = await previewsOf(db, [row.group.id]);
  return toGroup(row.group, me, row.locked, row.memberCount, previews.get(row.group.id) ?? []);
}

/** Active Groups of a User, the count the 20-Group cap applies to. */
export async function activeGroupCount(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(members)
    .where(and(eq(members.userId, userId), eq(members.status, "active")));
  return row?.n ?? 0;
}

export async function assertUnderGroupCap(db: Db, userId: string): Promise<void> {
  if ((await activeGroupCount(db, userId)) >= MAX_GROUPS_PER_USER) {
    throw new ApiError("GROUP_LIMIT_REACHED");
  }
}

/** Creates a Group with its creator as the first Member and Admin. */
export async function createGroup(
  db: Db,
  userId: string,
  input: GroupInput,
  now: number,
): Promise<Group> {
  await assertUnderGroupCap(db, userId);
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
  if (user === undefined) throw new ApiError("UNAUTHORIZED");
  const groupId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  await db.batch([
    db.insert(groups).values({
      id: groupId,
      name: input.name,
      settlementCurrency: input.settlementCurrency,
      defaultExpenseCurrency: input.settlementCurrency,
      isTrip: input.isTrip,
      tripDestination: input.tripDestination ?? null,
      tripStartDate: input.tripStartDate ?? null,
      tripEndDate: input.tripEndDate ?? null,
      tripNotes: input.tripNotes ?? null,
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(members).values({
      id: memberId,
      groupId,
      userId,
      role: "admin",
      status: "active",
      createdAt: now,
    }),
  ]);
  const [me] = await db.select().from(members).where(eq(members.id, memberId));
  if (me === undefined) throw new ApiError("INTERNAL");
  return loadGroup(db, me);
}

/**
 * Edits a Group (Admin only) under `If-Match`. The Settlement currency is fixed once the
 * Group has an Expense; the update re-checks that in the same statement.
 */
export async function patchGroup(
  db: Db,
  me: MemberRow,
  patch: GroupPatch,
  expectedUpdatedAt: number,
  now: number,
): Promise<Group> {
  requireAdmin(me);
  const current = await loadGroup(db, me);
  if (current.updatedAt !== expectedUpdatedAt) {
    throw new ApiError("EDIT_CONFLICT", { current });
  }
  const start = patch.tripStartDate === undefined ? current.tripStartDate : patch.tripStartDate;
  const end = patch.tripEndDate === undefined ? current.tripEndDate : patch.tripEndDate;
  if (!tripDatesValid(start, end)) {
    throw new ApiError("VALIDATION_FAILED", {
      issues: [{ path: ["tripEndDate"], message: "TRIP_DATES_INVALID" }],
    });
  }
  const changesCurrency =
    patch.settlementCurrency !== undefined &&
    patch.settlementCurrency !== current.settlementCurrency;
  if (changesCurrency && current.settlementCurrencyLocked) {
    throw new ApiError("SETTLEMENT_CURRENCY_LOCKED");
  }

  const updated = await db
    .update(groups)
    .set({
      ...patch,
      // The column outlives the removed setting: it always equals the Settlement currency.
      ...(patch.settlementCurrency === undefined
        ? {}
        : { defaultExpenseCurrency: patch.settlementCurrency }),
      updatedAt: Math.max(now, current.updatedAt + 1),
    })
    .where(
      and(
        eq(groups.id, me.groupId),
        eq(groups.updatedAt, expectedUpdatedAt),
        changesCurrency ? sql`NOT ${lockedSql}` : undefined,
      ),
    )
    .returning({ id: groups.id });
  if (updated.length === 0) {
    const latest = await loadGroup(db, me);
    if (changesCurrency && latest.settlementCurrencyLocked) {
      throw new ApiError("SETTLEMENT_CURRENCY_LOCKED");
    }
    throw new ApiError("EDIT_CONFLICT", { current: latest });
  }
  return loadGroup(db, me);
}

/** Hard-deletes a Group and everything under it (Admin only, decision 10). */
export async function deleteGroup(db: Db, me: MemberRow): Promise<void> {
  requireAdmin(me);
  await db.delete(groups).where(eq(groups.id, me.groupId));
}
