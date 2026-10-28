import {
  type Member,
  type MemberPatch,
  type PlaceholderInput,
  REMOVED_PLACEHOLDER_NAME,
} from "@split/shared";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { isConstraintError } from "../db/errors.js";
import { groups, members, users } from "../db/schema.js";
import { ApiError } from "../errors.js";
import { anotherAdmin, hasFreeSeat, type MemberRow, requireAdmin } from "./membership.js";

/** Every Member row of a Group in joining order, Former and Placeholder Members included. */
export async function listMembers(db: Db, groupId: string, meId: string | null): Promise<Member[]> {
  const rows = await db
    .select({ member: members, userName: users.displayName, pictureUrl: users.pictureUrl })
    .from(members)
    .leftJoin(users, eq(users.id, members.userId))
    .where(eq(members.groupId, groupId))
    // rowid breaks ties in insertion order: joining order feeds the leftover rule.
    .orderBy(asc(members.createdAt), sql`${members}.rowid`);
  return rows.map(({ member, userName, pictureUrl }) => ({
    id: member.id,
    userId: member.userId,
    displayName: member.nickname ?? userName ?? member.placeholderName ?? REMOVED_PLACEHOLDER_NAME,
    nickname: member.nickname,
    pictureUrl: member.status === "placeholder" ? null : pictureUrl,
    role: member.role,
    status: member.status,
    balance: member.netBalance,
    isMe: member.id === meId,
  }));
}

async function findMember(db: Db, groupId: string, memberId: string): Promise<MemberRow> {
  const [row] = await db
    .select()
    .from(members)
    .where(and(eq(members.groupId, groupId), eq(members.id, memberId)));
  if (row === undefined) throw new ApiError("NOT_FOUND");
  return row;
}

async function oneMember(db: Db, me: MemberRow, memberId: string): Promise<Member> {
  const found = (await listMembers(db, me.groupId, me.id)).find((m) => m.id === memberId);
  if (found === undefined) throw new ApiError("NOT_FOUND");
  return found;
}

async function balanceNotZero(db: Db, target: MemberRow): Promise<ApiError> {
  const [group] = await db
    .select({ currency: groups.settlementCurrency })
    .from(groups)
    .where(eq(groups.id, target.groupId));
  return new ApiError("BALANCE_NOT_ZERO", {
    balance: target.netBalance,
    currency: group?.currency ?? null,
  });
}

/**
 * Sets a Member's role (Admin only) or one's own Nickname. The last active Admin cannot be
 * demoted; that is re-checked inside the update so two demotions cannot both win.
 */
export async function patchMember(
  db: Db,
  me: MemberRow,
  memberId: string,
  patch: MemberPatch,
): Promise<Member> {
  const target = await findMember(db, me.groupId, memberId);
  if (patch.role !== undefined) {
    requireAdmin(me);
    if (target.status !== "active") throw new ApiError("MEMBER_NOT_ACTIVE");
  }
  if (patch.nickname !== undefined && target.id !== me.id) throw new ApiError("FORBIDDEN");

  const demotes = patch.role === "member" && target.role === "admin";
  const updated = await db
    .update(members)
    .set(patch)
    .where(
      and(eq(members.id, target.id), demotes ? anotherAdmin(me.groupId, target.id) : undefined),
    )
    .returning({ id: members.id });
  if (updated.length === 0) throw new ApiError("LAST_ADMIN");
  return oneMember(db, me, target.id);
}

/**
 * A Member leaves at a zero Balance and becomes a Former Member, kept by name in old
 * Expenses. The last active Admin must promote someone or delete the Group instead.
 */
export async function leaveGroup(db: Db, me: MemberRow): Promise<void> {
  if (me.netBalance !== 0) throw await balanceNotZero(db, me);
  const left = await db
    .update(members)
    .set({ status: "former", role: "member" })
    .where(
      and(
        eq(members.id, me.id),
        eq(members.netBalance, 0),
        sql`(${members.role} = 'member' OR ${anotherAdmin(me.groupId, me.id)})`,
      ),
    )
    .returning({ id: members.id });
  if (left.length > 0) return;
  const current = await findMember(db, me.groupId, me.id);
  throw current.netBalance !== 0 ? await balanceNotZero(db, current) : new ApiError("LAST_ADMIN");
}

/**
 * Removes a Member (Admin only), or leaves when the target is oneself. Either way the
 * Balance must be zero. A removed Placeholder Member's typed name is deleted: the row goes
 * entirely, or, when old Expenses still name it, it stays as a Former Member with a
 * generic label (decision 31's privacy rule).
 */
export async function removeMember(db: Db, me: MemberRow, memberId: string): Promise<void> {
  if (memberId === me.id) return leaveGroup(db, me);
  requireAdmin(me);
  const target = await findMember(db, me.groupId, memberId);
  if (target.status === "former") throw new ApiError("MEMBER_NOT_ACTIVE");
  if (target.netBalance !== 0) throw await balanceNotZero(db, target);

  const atZero = and(eq(members.id, target.id), eq(members.netBalance, 0));
  if (target.status === "active") {
    const removed = await db
      .update(members)
      .set({ status: "former", role: "member" })
      .where(atZero)
      .returning({ id: members.id });
    if (removed.length === 0)
      throw await balanceNotZero(db, await findMember(db, me.groupId, memberId));
    return;
  }

  try {
    const removed = await db.delete(members).where(atZero).returning({ id: members.id });
    if (removed.length === 0)
      throw await balanceNotZero(db, await findMember(db, me.groupId, memberId));
  } catch (error) {
    if (!isConstraintError(error, "FOREIGN KEY")) throw error;
    await db
      .update(members)
      .set({ status: "former", placeholderName: null, nickname: REMOVED_PLACEHOLDER_NAME })
      .where(atZero);
  }
}

/**
 * Any Member adds a Placeholder Member by name. The name must differ from every seated
 * Member's shown name, and the Placeholder takes one of the 30 seats.
 */
export async function addPlaceholder(
  db: Db,
  me: MemberRow,
  input: PlaceholderInput,
  now: number,
): Promise<Member> {
  const seated = (await listMembers(db, me.groupId, me.id)).filter((m) => m.status !== "former");
  if (seated.some((m) => m.displayName === input.name)) {
    throw new ApiError("PLACEHOLDER_NAME_TAKEN");
  }
  const id = crypto.randomUUID();
  const inserted = await db.run(sql`
    INSERT INTO members (id, group_id, user_id, placeholder_name, role, status, net_balance, created_by_member_id, created_at)
    SELECT ${id}, ${me.groupId}, NULL, ${input.name}, 'member', 'placeholder', 0, ${me.id}, ${now}
    WHERE ${hasFreeSeat(me.groupId)}
      AND NOT EXISTS (SELECT 1 FROM members p WHERE p.group_id = ${me.groupId} AND p.status = 'placeholder' AND p.placeholder_name = ${input.name})`);
  if (inserted.meta.changes === 0) {
    const [taken] = await db
      .select({ id: members.id })
      .from(members)
      .where(
        and(
          eq(members.groupId, me.groupId),
          eq(members.status, "placeholder"),
          eq(members.placeholderName, input.name),
        ),
      );
    throw new ApiError(taken === undefined ? "GROUP_FULL" : "PLACEHOLDER_NAME_TAKEN");
  }
  return oneMember(db, me, id);
}
