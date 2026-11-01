import {
  DELETED_USER_NAME,
  type Member,
  type MemberPatch,
  type PlaceholderInput,
  REMOVED_PLACEHOLDER_NAME,
} from "@split/shared";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import type { Bindings } from "../env.js";
import { memberOperation } from "./ledger-client.js";
import { groups, members, users } from "../db/schema.js";
import { ApiError } from "../errors.js";
import { type MemberRow, requireAdmin } from "./membership.js";

const isSystemLabel = (name: string | null): name is string =>
  name === DELETED_USER_NAME || name === REMOVED_PLACEHOLDER_NAME;

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
    // Names come from LINE or Google, or are typed for a Placeholder Member. The nickname column
    // survives only as the label of a Former Member (已刪除的使用者, 已移除的成員); a nickname
    // a Member once chose is never shown again, not even after they leave.
    displayName:
      (member.status === "former" && isSystemLabel(member.nickname) ? member.nickname : null) ??
      userName ??
      member.placeholderName ??
      REMOVED_PLACEHOLDER_NAME,
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

async function namesByUser(db: Db, groupId: string): Promise<Record<string, string>> {
  const rows = await db
    .select({ id: users.id, name: users.displayName })
    .from(users)
    .innerJoin(members, eq(members.userId, users.id))
    .where(eq(members.groupId, groupId));
  return Object.fromEntries(rows.map((row) => [row.id, row.name]));
}

export async function patchMember(
  db: Db,
  me: MemberRow,
  memberId: string,
  patch: MemberPatch,
  env: Bindings,
): Promise<{ member: Member; rev: number }> {
  const result = await memberOperation(env, me.groupId, {
    action: "patch",
    actorMemberId: me.id,
    targetMemberId: memberId,
    input: patch,
    now: Date.now(),
    names: await namesByUser(db, me.groupId),
  });
  return { member: await oneMember(db, me, memberId), rev: result.rev };
}

export async function leaveGroup(
  db: Db,
  me: MemberRow,
  env: Bindings,
): Promise<{ rev: number }> {
  const [group] = await db
    .select({ currency: groups.settlementCurrency })
    .from(groups)
    .where(eq(groups.id, me.groupId));
  const result = await memberOperation(env, me.groupId, {
    action: "leave",
    actorMemberId: me.id,
    targetMemberId: me.id,
    targetBalance: me.netBalance,
    currency: group?.currency ?? null,
    now: Date.now(),
  });
  return { rev: result.rev };
}

export async function removeMember(
  db: Db,
  me: MemberRow,
  memberId: string,
  env: Bindings,
): Promise<{ rev: number }> {
  if (memberId === me.id) return leaveGroup(db, me, env);
  requireAdmin(me);
  const target = await findMember(db, me.groupId, memberId);
  const [group] = await db
    .select({ currency: groups.settlementCurrency })
    .from(groups)
    .where(eq(groups.id, me.groupId));
  const history = await db.all<{ found: number }>(
    sql`SELECT 1 AS found FROM expense_payers WHERE member_id = ${memberId} UNION SELECT 1 AS found FROM expense_splits WHERE member_id = ${memberId} LIMIT 1`,
  );
  const result = await memberOperation(env, me.groupId, {
    action: "remove",
    actorMemberId: me.id,
    targetMemberId: memberId,
    targetBalance: target.netBalance,
    currency: group?.currency ?? null,
    hasHistory: history.length > 0,
    now: Date.now(),
  });
  return { rev: result.rev };
}

export async function addPlaceholder(
  db: Db,
  me: MemberRow,
  input: PlaceholderInput,
  now: number,
  env: Bindings,
): Promise<{ member: Member; rev: number }> {
  const result = await memberOperation(env, me.groupId, {
    action: "add",
    actorMemberId: me.id,
    targetMemberId: crypto.randomUUID(),
    input,
    now,
    names: await namesByUser(db, me.groupId),
  });
  return { member: await oneMember(db, me, result.memberId), rev: result.rev };
}
