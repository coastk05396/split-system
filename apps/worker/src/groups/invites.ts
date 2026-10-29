import {
  INVITE_TTL_MS,
  type Invite,
  type InvitePreview,
  type JoinResult,
  MAX_MEMBERS_PER_GROUP,
} from "@split/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { isConstraintError } from "../db/errors.js";
import { groups, invites, members } from "../db/schema.js";
import { ApiError } from "../errors.js";
import { assertUnderGroupCap } from "./groups.js";
import { listMembers } from "./members.js";
import { hasFreeSeat, type MemberRow, requireAdmin } from "./membership.js";

/** 256 random bits, base64url: unguessable, and the whole secret of the link. */
function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Makes the Group's one live link, killing any earlier one in the same batch (Admin only). */
export async function regenerateInvite(db: Db, me: MemberRow, now: number): Promise<Invite> {
  requireAdmin(me);
  const invite = { token: newToken(), expiresAt: now + INVITE_TTL_MS };
  await db.batch([
    db.delete(invites).where(eq(invites.groupId, me.groupId)),
    db
      .insert(invites)
      .values({ id: crypto.randomUUID(), groupId: me.groupId, ...invite, createdAt: now }),
  ]);
  return invite;
}

/** The live link any Member can share, or 404 when none is live. */
export async function currentInvite(db: Db, me: MemberRow, now: number): Promise<Invite> {
  const [row] = await db
    .select({ token: invites.token, expiresAt: invites.expiresAt })
    .from(invites)
    .where(eq(invites.groupId, me.groupId))
    .orderBy(desc(invites.createdAt));
  if (row === undefined || row.expiresAt <= now) throw new ApiError("NOT_FOUND");
  return row;
}

/** A live Invite's Group; a regenerated (deleted) link is 404, a lapsed one INVITE_EXPIRED. */
async function openInvite(db: Db, token: string, now: number) {
  const [row] = await db
    .select({ group: groups, expiresAt: invites.expiresAt })
    .from(invites)
    .innerJoin(groups, eq(groups.id, invites.groupId))
    .where(eq(invites.token, token));
  if (row === undefined) throw new ApiError("NOT_FOUND");
  if (row.expiresAt <= now) throw new ApiError("INVITE_EXPIRED");
  return row;
}

async function ownRow(db: Db, groupId: string, userId: string): Promise<MemberRow | undefined> {
  const [row] = await db
    .select()
    .from(members)
    .where(and(eq(members.groupId, groupId), eq(members.userId, userId)));
  return row;
}

/** Distinct Expenses each Member pays or shares in, for the claim confirmation. */
async function expenseCounts(db: Db, groupId: string): Promise<Map<string, number>> {
  const rows = await db.all<{ memberId: string; n: number }>(sql`
    SELECT x.member_id AS memberId, count(DISTINCT x.expense_id) AS n
    FROM (
      SELECT p.member_id, p.expense_id FROM expense_payers p
      UNION SELECT s.member_id, s.expense_id FROM expense_splits s
    ) x
    JOIN members m ON m.id = x.member_id
    WHERE m.group_id = ${groupId} AND m.status = 'placeholder'
    GROUP BY x.member_id`);
  return new Map(rows.map((r) => [r.memberId, r.n]));
}

/**
 * What the join screen shows: the Group, its seat count and its unclaimed Placeholder
 * Members by name, with who typed each name and what claiming it takes on.
 */
export async function previewInvite(
  db: Db,
  token: string,
  userId: string,
  now: number,
): Promise<InvitePreview> {
  const { group, expiresAt } = await openInvite(db, token, now);
  const mine = await ownRow(db, group.id, userId);
  const isMember = mine?.status === "active";
  const everyone = await listMembers(db, group.id, mine?.id ?? null);
  const seated = everyone.filter((m) => m.status !== "former");
  if (!isMember && seated.length >= MAX_MEMBERS_PER_GROUP) throw new ApiError("GROUP_FULL");

  const rows = await db
    .select({ id: members.id, createdBy: members.createdByMemberId })
    .from(members)
    .where(and(eq(members.groupId, group.id), eq(members.status, "placeholder")));
  const creatorOf = new Map(rows.map((r) => [r.id, r.createdBy]));
  const nameOf = new Map(everyone.map((m) => [m.id, m.displayName]));
  const counts = await expenseCounts(db, group.id);

  return {
    groupId: group.id,
    groupName: group.name,
    settlementCurrency: group.settlementCurrency,
    memberCount: seated.length,
    expiresAt,
    isMember,
    placeholders: everyone
      .filter((m) => m.status === "placeholder")
      .map((m) => {
        const creator = creatorOf.get(m.id) ?? null;
        return {
          memberId: m.id,
          name: m.displayName,
          addedBy: creator === null ? null : (nameOf.get(creator) ?? null),
          balance: m.balance,
          expenseCount: counts.get(m.id) ?? 0,
        };
      }),
  };
}

/**
 * Joins at once as a plain Member. Someone already in the Group just opens it; a Former
 * Member's row comes back to life. The seat check runs inside the writing statement.
 */
export async function joinGroup(
  db: Db,
  token: string,
  userId: string,
  now: number,
): Promise<JoinResult> {
  const { group } = await openInvite(db, token, now);
  const mine = await ownRow(db, group.id, userId);
  if (mine?.status === "active") return { groupId: group.id, memberId: mine.id };
  await assertUnderGroupCap(db, userId);

  if (mine !== undefined) {
    const back = await db
      .update(members)
      .set({ status: "active", role: "member" })
      .where(and(eq(members.id, mine.id), eq(members.status, "former"), hasFreeSeat(group.id)))
      .returning({ id: members.id });
    if (back.length === 0) throw new ApiError("GROUP_FULL");
    return { groupId: group.id, memberId: mine.id };
  }

  const memberId = crypto.randomUUID();
  try {
    const inserted = await db.run(sql`
      INSERT INTO members (id, group_id, user_id, role, status, net_balance, created_at)
      SELECT ${memberId}, ${group.id}, ${userId}, 'member', 'active', 0, ${now}
      WHERE ${hasFreeSeat(group.id)}`);
    if (inserted.meta.changes === 0) throw new ApiError("GROUP_FULL");
  } catch (error) {
    // A second tap raced the first one in; that row is the person's.
    if (!isConstraintError(error, "UNIQUE")) throw error;
    const winner = await ownRow(db, group.id, userId);
    if (winner === undefined) throw error;
    return { groupId: group.id, memberId: winner.id };
  }
  return { groupId: group.id, memberId };
}

/**
 * Joins by taking over a Placeholder Member: the row becomes the User's and keeps every
 * Expense, split, Settlement and its Balance. There is no undo; the typed name is dropped.
 */
export async function claimPlaceholder(
  db: Db,
  token: string,
  userId: string,
  placeholderId: string,
  now: number,
): Promise<JoinResult> {
  const { group } = await openInvite(db, token, now);
  if ((await ownRow(db, group.id, userId)) !== undefined) throw new ApiError("ALREADY_MEMBER");
  await assertUnderGroupCap(db, userId);

  let claimed: { id: string }[];
  try {
    claimed = await db
      .update(members)
      .set({ userId, status: "active", placeholderName: null })
      .where(
        and(
          eq(members.id, placeholderId),
          eq(members.groupId, group.id),
          eq(members.status, "placeholder"),
        ),
      )
      .returning({ id: members.id });
  } catch (error) {
    if (isConstraintError(error, "UNIQUE")) throw new ApiError("ALREADY_MEMBER");
    throw error;
  }
  if (claimed.length > 0) return { groupId: group.id, memberId: placeholderId };

  const [row] = await db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.id, placeholderId), eq(members.groupId, group.id)));
  throw new ApiError(row === undefined ? "NOT_FOUND" : "PLACEHOLDER_CLAIMED");
}
