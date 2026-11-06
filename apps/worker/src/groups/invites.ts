import { withReservation } from "../auth/reservations.js";
import {
  INVITE_TTL_MS,
  type Invite,
  type InvitePreview,
  type JoinResult,
  MAX_MEMBERS_PER_GROUP,
} from "@split/shared";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import type { Bindings } from "../env.js";
import { groupLedger } from "../ledger-client.js";
import { groupDirectory, invites } from "../db/schema.js";
import { ApiError } from "../errors.js";
import { assertUnderGroupCap } from "./groups.js";
import { listMembers } from "./members.js";
import { findMembership, type MemberRow, requireAdmin } from "./membership.js";

/** 256 random bits, base64url: unguessable, and the whole secret of the link. */
function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function ledgerInvite(
  env: Bindings,
  groupId: string,
  action: "get" | "ensure" | "regenerate" | "validate",
  now: number,
  token?: string,
  actorMemberId?: string,
  setRev?: (rev: string) => void,
): Promise<Invite> {
  const { value, rev } = await groupLedger(env, groupId)
    .invite({
      action,
      now,
      actorMemberId,
      token: token ?? (action === "ensure" || action === "regenerate" ? newToken() : undefined),
      expiresAt: now + INVITE_TTL_MS,
    })
    .catch((error: unknown) => {
      if (!(error instanceof ApiError)) throw error;
      const kept = error.code === "INVITE_EXPIRED" || error.code === "FORBIDDEN";
      throw new ApiError(kept ? error.code : "NOT_FOUND");
    });
  setRev?.(String(rev));
  return value;
}

export async function regenerateInvite(
  me: MemberRow,
  now: number,
  env: Bindings,
  setRev?: (rev: string) => void,
): Promise<Invite> {
  requireAdmin(me);
  return ledgerInvite(env, me.groupId, "regenerate", now, undefined, me.id, setRev);
}

export async function currentInvite(me: MemberRow, now: number, env: Bindings): Promise<Invite> {
  return ledgerInvite(env, me.groupId, "get", now, undefined, me.id);
}

export async function ensureInvite(
  me: MemberRow,
  now: number,
  env: Bindings,
  setRev?: (rev: string) => void,
): Promise<Invite> {
  return ledgerInvite(env, me.groupId, "ensure", now, undefined, me.id, setRev);
}

/** A live Invite's Group; a regenerated (deleted) link is 404, a lapsed one INVITE_EXPIRED. */
async function openInvite(db: Db, token: string, now: number, env: Bindings) {
  const [row] = await db
    .select({ groupId: invites.groupId, expiresAt: invites.expiresAt })
    .from(invites)
    .where(eq(invites.token, token));
  if (row === undefined) throw new ApiError("NOT_FOUND");
  await ledgerInvite(env, row.groupId, "validate", now, token);
  const [dir] = await db
    .select({ name: groupDirectory.name, settlementCurrency: groupDirectory.settlementCurrency })
    .from(groupDirectory)
    .where(eq(groupDirectory.groupId, row.groupId));
  const group = {
    id: row.groupId,
    name: dir?.name ?? "",
    settlementCurrency: dir?.settlementCurrency ?? "TWD",
  };
  return { group, expiresAt: row.expiresAt };
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
  env: Bindings,
): Promise<InvitePreview> {
  const { group, expiresAt } = await openInvite(db, token, now, env);
  const mine = await findMembership(db, group.id, userId);
  const isMember = mine?.status === "active";
  const everyone = await listMembers(db, group.id, mine?.id ?? null, env);
  const seated = everyone.filter((m) => m.status !== "former");
  if (!isMember && seated.length >= MAX_MEMBERS_PER_GROUP) throw new ApiError("GROUP_FULL");

  const creatorOf = new Map(everyone.map((m) => [m.id, m.createdByMemberId]));
  const nameOf = new Map(everyone.map((m) => [m.id, m.displayName]));
  const { value: placeholderCounts } = await groupLedger(env, group.id)
    .placeholderCounts()
    .catch(() => {
      throw new ApiError("INTERNAL");
    });
  const counts = new Map(Object.entries(placeholderCounts));

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

/** Whether the ledger has the User seated in the Group: the truth after an unclear failure. */
async function isSeated(db: Db, env: Bindings, groupId: string, userId: string): Promise<boolean> {
  const everyone = await listMembers(db, groupId, null, env);
  return everyone.some((m) => m.userId === userId && m.status !== "former");
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
  env: Bindings,
  setRev?: (rev: string) => void,
): Promise<JoinResult> {
  const { group } = await openInvite(db, token, now, env);
  const result = await withReservation(
    env.DB,
    userId,
    group.id,
    now,
    async () => {
      const mine = await findMembership(db, group.id, userId);
      if (mine?.status !== "active") await assertUnderGroupCap(db, userId);
      return groupLedger(env, group.id).member({
        action: "join",
        inviteToken: token,
        userId,
        targetMemberId: mine?.id ?? crypto.randomUUID(),
        now,
      });
    },
    () => isSeated(db, env, group.id, userId),
  );
  setRev?.(String(result.rev));
  return { groupId: group.id, memberId: result.value.memberId };
}

export async function claimPlaceholder(
  db: Db,
  token: string,
  userId: string,
  placeholderId: string,
  now: number,
  env: Bindings,
  setRev?: (rev: string) => void,
): Promise<JoinResult> {
  const { group } = await openInvite(db, token, now, env);
  if ((await findMembership(db, group.id, userId)) !== undefined)
    throw new ApiError("ALREADY_MEMBER");
  await assertUnderGroupCap(db, userId);
  const result = await withReservation(
    env.DB,
    userId,
    group.id,
    now,
    () =>
      groupLedger(env, group.id).member({
        action: "claim",
        inviteToken: token,
        userId,
        targetMemberId: placeholderId,
        now,
      }),
    () => isSeated(db, env, group.id, userId),
  );
  setRev?.(String(result.rev));
  return { groupId: group.id, memberId: result.value.memberId };
}
