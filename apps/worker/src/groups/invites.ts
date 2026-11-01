import { withReservation } from "../auth/reservations.js";
import {
  INVITE_TTL_MS,
  type Invite,
  type InvitePreview,
  type JoinResult,
  MAX_MEMBERS_PER_GROUP,
} from "@split/shared";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import type { Bindings } from "../env.js";
import { memberOperation } from "./ledger-client.js";
import { groups, invites, members } from "../db/schema.js";
import { ApiError } from "../errors.js";
import { assertUnderGroupCap } from "./groups.js";
import { listMembers } from "./members.js";
import { type MemberRow, requireAdmin } from "./membership.js";

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
  const response = await env.GROUP_LEDGER.get(env.GROUP_LEDGER.idFromName(groupId)).fetch(
    "https://ledger.internal/invite",
    {
      method: "POST",
      body: JSON.stringify({
        action,
        now,
        actorMemberId,
        token: token ?? (action === "ensure" || action === "regenerate" ? newToken() : undefined),
        expiresAt: now + INVITE_TTL_MS,
      }),
    },
  );
  const data = await response.json<Invite | { error: string }>();
  if ("error" in data)
    throw new ApiError(
      data.error === "INVITE_EXPIRED"
        ? "INVITE_EXPIRED"
        : data.error === "FORBIDDEN"
          ? "FORBIDDEN"
          : "NOT_FOUND",
    );
  const rev = response.headers.get("X-Group-Rev");
  if (rev !== null) setRev?.(rev);
  return data;
}

export async function regenerateInvite(
  _db: Db,
  me: MemberRow,
  now: number,
  env: Bindings,
  setRev?: (rev: string) => void,
): Promise<Invite> {
  requireAdmin(me);
  return ledgerInvite(env, me.groupId, "regenerate", now, undefined, me.id, setRev);
}

export async function currentInvite(
  _db: Db,
  me: MemberRow,
  now: number,
  env: Bindings,
): Promise<Invite> {
  return ledgerInvite(env, me.groupId, "get", now, undefined, me.id);
}

export async function ensureInvite(
  _db: Db,
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
    .select({ group: groups, expiresAt: invites.expiresAt })
    .from(invites)
    .innerJoin(groups, eq(groups.id, invites.groupId))
    .where(eq(invites.token, token));
  if (row === undefined) throw new ApiError("NOT_FOUND");
  await ledgerInvite(env, row.group.id, "validate", now, token);
  return row;
}

async function ownRow(db: Db, groupId: string, userId: string): Promise<MemberRow | undefined> {
  const [row] = await db
    .select()
    .from(members)
    .where(and(eq(members.groupId, groupId), eq(members.userId, userId)));
  return row;
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
  const response = await env.GROUP_LEDGER.get(env.GROUP_LEDGER.idFromName(group.id)).fetch(
    "https://ledger.internal/placeholder-counts",
  );
  if (!response.ok) throw new ApiError("INTERNAL");
  const counts = new Map(Object.entries(await response.json<Record<string, number>>()));

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
  env: Bindings,
  setRev?: (rev: string) => void,
): Promise<JoinResult> {
  const { group } = await openInvite(db, token, now, env);
  const result = await withReservation(env.DB, userId, group.id, now, async () => {
    const mine = await ownRow(db, group.id, userId);
    if (mine?.status !== "active") await assertUnderGroupCap(db, userId);
    return memberOperation(env, group.id, {
      action: "join",
      inviteToken: token,
      userId,
      targetMemberId: mine?.id ?? crypto.randomUUID(),
      now,
    });
  });
  setRev?.(String(result.rev));
  return { groupId: group.id, memberId: result.memberId };
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
  if ((await ownRow(db, group.id, userId)) !== undefined) throw new ApiError("ALREADY_MEMBER");
  await assertUnderGroupCap(db, userId);
  const result = await withReservation(env.DB, userId, group.id, now, () =>
    memberOperation(env, group.id, {
      action: "claim",
      inviteToken: token,
      userId,
      targetMemberId: placeholderId,
      now,
    }),
  );
  setRev?.(String(result.rev));
  return { groupId: group.id, memberId: result.memberId };
}
