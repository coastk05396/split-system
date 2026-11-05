import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { groupMemberSummary } from "../db/schema.js";
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

/**
 * The signed-in User's active Member row in a Group. Anyone else, including a Former
 * Member, gets 404 so a Group's existence is never revealed to outsiders.
 */
export async function requireMember(db: Db, groupId: string, userId: string): Promise<MemberRow> {
  const [me] = await db
    .select({
      memberId: groupMemberSummary.memberId,
      groupId: groupMemberSummary.groupId,
      userId: groupMemberSummary.userId,
      role: groupMemberSummary.role,
      netBalance: groupMemberSummary.netBalance,
    })
    .from(groupMemberSummary)
    .where(and(eq(groupMemberSummary.groupId, groupId), eq(groupMemberSummary.userId, userId)));
  if (me === undefined) throw new ApiError("NOT_FOUND");
  return {
    id: me.memberId,
    groupId: me.groupId,
    userId: me.userId,
    role: me.role,
    status: "active",
    netBalance: me.netBalance,
    createdAt: 0,
  };
}

export function requireAdmin(me: MemberRow): void {
  if (me.role !== "admin") throw new ApiError("FORBIDDEN");
}
