import { MAX_MEMBERS_PER_GROUP } from "@split/shared";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { members } from "../db/schema.js";
import { ApiError } from "../errors.js";

export type MemberRow = typeof members.$inferSelect;

/**
 * The signed-in User's active Member row in a Group. Anyone else, including a Former
 * Member, gets 404 so a Group's existence is never revealed to outsiders.
 */
export async function requireMember(db: Db, groupId: string, userId: string): Promise<MemberRow> {
  const [me] = await db
    .select()
    .from(members)
    .where(
      and(eq(members.groupId, groupId), eq(members.userId, userId), eq(members.status, "active")),
    );
  if (me === undefined) throw new ApiError("NOT_FOUND");
  return me;
}

export function requireAdmin(me: MemberRow): void {
  if (me.role !== "admin") throw new ApiError("FORBIDDEN");
}

/**
 * SQL condition: the Group still has a free seat. Active and Placeholder Members take a
 * seat (decision 31). Used inside the writing statement so two joins cannot both take the
 * 30th seat.
 */
export function hasFreeSeat(groupId: string) {
  return sql`(SELECT count(*) FROM members s WHERE s.group_id = ${groupId} AND s.status IN ('active', 'placeholder')) < ${MAX_MEMBERS_PER_GROUP}`;
}

/** SQL condition: some active Admin other than `memberId` remains in the Group. */
export function anotherAdmin(groupId: string, memberId: string) {
  return sql`EXISTS (SELECT 1 FROM members a WHERE a.group_id = ${groupId} AND a.id <> ${memberId} AND a.role = 'admin' AND a.status = 'active')`;
}
