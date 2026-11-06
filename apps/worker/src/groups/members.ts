import {
  DELETED_USER_NAME,
  type Member,
  type MemberPatch,
  type PlaceholderInput,
  REMOVED_PLACEHOLDER_NAME,
} from "@split/shared";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import type { Bindings } from "../env.js";
import { groupLedger } from "../ledger-client.js";
import type { LedgerMember } from "../ledger-types.js";
import { groupDirectory, groupMemberSummary, users } from "../db/schema.js";
import { ApiError } from "../errors.js";
import { usersById } from "./groups.js";
import type { MemberRow } from "./membership.js";

const isSystemLabel = (name: string | null): name is string =>
  name === DELETED_USER_NAME || name === REMOVED_PLACEHOLDER_NAME;

function hydrateMember(
  member: LedgerMember,
  meId: string | null,
  user?: { displayName: string; pictureUrl: string | null },
): Member & { createdByMemberId?: string | null } {
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
  // The ledger answers NOT_FOUND for a deleted Group or a User who is not seated.
  const { value: ledgerMembers, rev } = await groupLedger(env, groupId).members(asUserId);
  const byId = await usersById(
    db,
    ledgerMembers.map((m) => m.userId),
  );
  const members = ledgerMembers.map((member) =>
    hydrateMember(member, meId, member.userId ? byId.get(member.userId) : undefined),
  );
  return { members, rev };
}

/** Projects a Group's Settlement currency and Member Balances. */
export async function readBalances(db: Db, groupId: string, meId: string, env: Bindings) {
  const [group] = await db
    .select({ settlementCurrency: groupDirectory.settlementCurrency })
    .from(groupDirectory)
    .where(eq(groupDirectory.groupId, groupId));
  if (group === undefined) throw new ApiError("NOT_FOUND");
  const list = await listMembers(db, groupId, meId, env);
  return {
    settlementCurrency: group.settlementCurrency,
    balances: list.map((m) => ({
      memberId: m.id,
      displayName: m.displayName,
      status: m.status,
      balance: m.balance,
    })),
  };
}

async function namesByUser(db: Db, groupId: string): Promise<Record<string, string>> {
  const rows = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(groupMemberSummary)
    .innerJoin(users, eq(users.id, groupMemberSummary.userId))
    .where(eq(groupMemberSummary.groupId, groupId));
  return Object.fromEntries(rows.map((r) => [r.id, r.displayName]));
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
    names: patch.placeholderName === undefined ? undefined : await namesByUser(db, me.groupId),
  });
  const row = result.value.member;
  if (row === undefined) throw new ApiError("NOT_FOUND");
  const user =
    row.userId === null ? undefined : (await usersById(db, [row.userId])).get(row.userId);
  return { member: hydrateMember(row, me.id, user), rev: result.rev };
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
    names: await namesByUser(db, me.groupId),
  });
  const row = result.value.member;
  if (row === undefined) throw new ApiError("NOT_FOUND");
  return { member: hydrateMember(row, me.id), rev: result.rev };
}
