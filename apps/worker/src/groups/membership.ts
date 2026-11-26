import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { groupMemberSummary, mergeCleanups } from "../db/schema.js";
import { ApiError } from "../errors.js";

export interface MemberRow {
  id: string;
  groupId: string;
  userId: string | null;
  placeholderName?: string | null;
  nickname?: string | null;
  role: "admin" | "member";
  status: "active" | "former" | "placeholder";
  netBalance: number;
  createdByMemberId?: string | null;
  createdAt: number;
}

function toMemberRow(
  me: {
    memberId: string;
    groupId: string;
    role: "admin" | "member";
    netBalance: number;
  },
  userId: string,
): MemberRow {
  return {
    id: me.memberId,
    groupId: me.groupId,
    userId,
    role: me.role,
    status: "active",
    netBalance: me.netBalance,
    createdAt: 0,
  };
}

/** The signed-in User's active Member row in a Group, or undefined when they are not seated. */
export async function findMembership(
  db: Db,
  groupId: string,
  userId: string,
): Promise<MemberRow | undefined> {
  const [me] = await db
    .select({
      memberId: groupMemberSummary.memberId,
      groupId: groupMemberSummary.groupId,
      role: groupMemberSummary.role,
      netBalance: groupMemberSummary.netBalance,
    })
    .from(groupMemberSummary)
    .where(and(eq(groupMemberSummary.groupId, groupId), eq(groupMemberSummary.userId, userId)));
  if (me !== undefined) return toMemberRow(me, userId);
  const [pending] = await db
    .select({
      memberId: groupMemberSummary.memberId,
      groupId: groupMemberSummary.groupId,
      role: groupMemberSummary.role,
      netBalance: groupMemberSummary.netBalance,
    })
    .from(groupMemberSummary)
    .innerJoin(
      mergeCleanups,
      and(
        eq(mergeCleanups.groupId, groupMemberSummary.groupId),
        eq(mergeCleanups.otherUserId, groupMemberSummary.userId),
      ),
    )
    .where(and(eq(groupMemberSummary.groupId, groupId), eq(mergeCleanups.keptUserId, userId)))
    .limit(1);
  return pending === undefined ? undefined : toMemberRow(pending, userId);
}

/**
 * The signed-in User's active Member row in a Group. Anyone else, including a Former
 * Member, gets 404 so a Group's existence is never revealed to outsiders.
 */
export async function requireMember(db: Db, groupId: string, userId: string): Promise<MemberRow> {
  const me = await findMembership(db, groupId, userId);
  if (me === undefined) throw new ApiError("NOT_FOUND");
  return me;
}

/** True while any User Merge has not yet completed on this Group's ledger. */
export async function isGroupMerging(db: Db, groupId: string): Promise<boolean> {
  const [row] = await db
    .select({ groupId: mergeCleanups.groupId })
    .from(mergeCleanups)
    .where(eq(mergeCleanups.groupId, groupId))
    .limit(1);
  return row !== undefined;
}

/** Refuses writes while a Group's ledger is still finishing a User Merge. */
export async function assertGroupNotMerging(db: Db, groupId: string): Promise<void> {
  if (await isGroupMerging(db, groupId)) throw new ApiError("GROUP_MERGING");
}

/** Active Member check for write routes: 404 to non-Members, 409 GROUP_MERGING while merging. */
export async function requireWritableMember(
  db: Db,
  groupId: string,
  userId: string,
): Promise<MemberRow> {
  const me = await requireMember(db, groupId, userId);
  await assertGroupNotMerging(db, me.groupId);
  return me;
}

export function requireAdmin(me: MemberRow): void {
  if (me.role !== "admin") throw new ApiError("FORBIDDEN");
}
