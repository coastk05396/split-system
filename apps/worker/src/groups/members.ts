import {
  DELETED_USER_NAME,
  type Member,
  type MemberPatch,
  type PlaceholderInput,
  REMOVED_PLACEHOLDER_NAME,
} from "@split/shared";
import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import type { Bindings } from "../env.js";
import { memberOperation } from "./ledger-client.js";
import { groupDirectory, users } from "../db/schema.js";
import { ApiError } from "../errors.js";
import type { MemberRow } from "./membership.js";

const isSystemLabel = (name: string | null): name is string =>
  name === DELETED_USER_NAME || name === REMOVED_PLACEHOLDER_NAME;

export interface LedgerMemberInfo {
  id: string;
  user_id: string | null;
  role: "admin" | "member";
  status: "active" | "former" | "placeholder";
  net_balance: number;
  placeholder_name: string | null;
  nickname: string | null;
  created_by_member_id?: string | null;
}

/** Every Member row of a Group in joining order, Former and Placeholder Members included. */
export async function listMembers(
  db: Db,
  groupId: string,
  meId: string | null,
  env: Bindings,
): Promise<Array<Member & { createdByMemberId?: string | null }>> {
  return (await listMembersWithRev(db, groupId, meId, env)).members;
}

/**
 * As listMembers, with the ledger revision the Members were read at. With `asUserId` the
 * ledger itself checks that User is seated, so a lagging D1 copy cannot widen who may read.
 */
export async function listMembersWithRev(
  db: Db,
  groupId: string,
  meId: string | null,
  env: Bindings,
  asUserId?: string,
): Promise<{ members: Array<Member & { createdByMemberId?: string | null }>; rev: number }> {
  const resp = await env.GROUP_LEDGER.get(env.GROUP_LEDGER.idFromName(groupId)).fetch(
    "https://ledger.internal/members",
    asUserId === undefined ? undefined : { headers: { "X-User-Id": asUserId } },
  );
  if (!resp.ok) throw new ApiError("NOT_FOUND");
  const { members: ledgerMembers, rev } = await resp.json<{
    members: LedgerMemberInfo[];
    rev: number;
  }>();

  const userIds = ledgerMembers.flatMap((m) => (m.user_id ? [m.user_id] : []));
  const userRows =
    userIds.length === 0
      ? []
      : await db
          .select({ id: users.id, displayName: users.displayName, pictureUrl: users.pictureUrl })
          .from(users)
          .where(inArray(users.id, userIds));
  const usersById = new Map(userRows.map((u) => [u.id, u]));

  const members = ledgerMembers.map((member) => {
    const user = member.user_id ? usersById.get(member.user_id) : undefined;
    return {
      id: member.id,
      userId: member.user_id,
      displayName:
        (member.status === "former" && isSystemLabel(member.nickname) ? member.nickname : null) ??
        user?.displayName ??
        (member.user_id
          ? DELETED_USER_NAME
          : (member.placeholder_name ?? REMOVED_PLACEHOLDER_NAME)),
      pictureUrl: member.status === "placeholder" ? null : (user?.pictureUrl ?? null),
      role: member.role,
      status: member.status,
      balance: member.net_balance,
      isMe: member.id === meId,
      createdByMemberId: member.created_by_member_id ?? null,
    };
  });
  return { members, rev };
}

async function oneMember(db: Db, me: MemberRow, memberId: string, env: Bindings): Promise<Member> {
  const found = (await listMembers(db, me.groupId, me.id, env)).find((m) => m.id === memberId);
  if (found === undefined) throw new ApiError("NOT_FOUND");
  return found;
}

async function namesByUser(
  db: Db,
  groupId: string,
  env: Bindings,
): Promise<Record<string, string>> {
  const members = await listMembers(db, groupId, null, env);
  const rows: Record<string, string> = {};
  for (const m of members) {
    if (m.userId) {
      rows[m.userId] = m.displayName;
    }
  }
  return rows;
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
    names: await namesByUser(db, me.groupId, env),
  });
  return { member: await oneMember(db, me, memberId, env), rev: result.rev };
}

export async function leaveGroup(db: Db, me: MemberRow, env: Bindings): Promise<{ rev: number }> {
  const dir = await db
    .select({ currency: groupDirectory.settlementCurrency })
    .from(groupDirectory)
    .where(eq(groupDirectory.groupId, me.groupId));
  const result = await memberOperation(env, me.groupId, {
    action: "leave",
    actorMemberId: me.id,
    targetMemberId: me.id,
    targetBalance: me.netBalance,
    currency: dir[0]?.currency ?? null,
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
  // The ledger decides who may remove whom: any Member may remove a Placeholder, only an admin
  // may remove anyone else.
  const result = await memberOperation(env, me.groupId, {
    action: "remove",
    actorMemberId: me.id,
    targetMemberId: memberId,
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
    names: await namesByUser(db, me.groupId, env),
  });
  return { member: await oneMember(db, me, result.memberId, env), rev: result.rev };
}
