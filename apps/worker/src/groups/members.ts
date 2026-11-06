import {
  DELETED_USER_NAME,
  type Member,
  type MemberPatch,
  type PlaceholderInput,
  REMOVED_PLACEHOLDER_NAME,
} from "@split/shared";
import { inArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import type { Bindings } from "../env.js";
import { groupLedger } from "../ledger-client.js";
import { users } from "../db/schema.js";
import { ApiError } from "../errors.js";
import type { MemberRow } from "./membership.js";

const isSystemLabel = (name: string | null): name is string =>
  name === DELETED_USER_NAME || name === REMOVED_PLACEHOLDER_NAME;

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
  // The ledger answers NOT_FOUND for a deleted Group or a User who is not seated.
  const { value: ledgerMembers, rev } = await groupLedger(env, groupId).members(asUserId);

  const userIds = ledgerMembers.flatMap((m) => (m.userId ? [m.userId] : []));
  const userRows =
    userIds.length === 0
      ? []
      : await db
          .select({ id: users.id, displayName: users.displayName, pictureUrl: users.pictureUrl })
          .from(users)
          .where(inArray(users.id, userIds));
  const usersById = new Map(userRows.map((u) => [u.id, u]));

  const members = ledgerMembers.map((member) => {
    const user = member.userId ? usersById.get(member.userId) : undefined;
    return {
      id: member.id,
      userId: member.userId,
      displayName:
        (member.status === "former" && isSystemLabel(member.nickname) ? member.nickname : null) ??
        user?.displayName ??
        (member.userId ? DELETED_USER_NAME : (member.placeholderName ?? REMOVED_PLACEHOLDER_NAME)),
      pictureUrl: member.status === "placeholder" ? null : (user?.pictureUrl ?? null),
      role: member.role,
      status: member.status,
      balance: member.balance,
      isMe: member.id === meId,
      createdByMemberId: member.createdByMemberId,
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
  const result = await groupLedger(env, me.groupId).member({
    action: "patch",
    actorMemberId: me.id,
    targetMemberId: memberId,
    input: patch,
    now: Date.now(),
    names: await namesByUser(db, me.groupId, env),
  });
  return { member: await oneMember(db, me, memberId, env), rev: result.rev };
}

export async function leaveGroup(me: MemberRow, env: Bindings): Promise<{ rev: number }> {
  const result = await groupLedger(env, me.groupId).member({
    action: "leave",
    actorMemberId: me.id,
    targetMemberId: me.id,
    now: Date.now(),
  });
  return { rev: result.rev };
}

export async function removeMember(
  me: MemberRow,
  memberId: string,
  env: Bindings,
): Promise<{ rev: number }> {
  if (memberId === me.id) return leaveGroup(me, env);
  // The ledger decides who may remove whom: any Member may remove a Placeholder, only an admin
  // may remove anyone else.
  const result = await groupLedger(env, me.groupId).member({
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
  const result = await groupLedger(env, me.groupId).member({
    action: "add",
    actorMemberId: me.id,
    targetMemberId: crypto.randomUUID(),
    input,
    now,
    names: await namesByUser(db, me.groupId, env),
  });
  return { member: await oneMember(db, me, result.value.memberId, env), rev: result.rev };
}
