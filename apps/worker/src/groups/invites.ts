import { reserveGroup } from "../auth/reservations.js";
import {
  INVITE_TTL_MS,
  type Invite,
  type InvitePreview,
  type JoinResult,
  MAX_MEMBERS_PER_GROUP,
} from "@split/shared";
import { and, desc, eq, gt, sql } from "drizzle-orm";
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

/** Makes the Group's one live link, killing any earlier one in the same batch (Admin only). */
export async function regenerateInvite(db: Db, me: MemberRow, now: number): Promise<Invite> {
  requireAdmin(me);
  const invite = { token: newToken(), expiresAt: now + INVITE_TTL_MS };
  await db.batch([
    db.delete(invites).where(eq(invites.groupId, me.groupId)),
    db
      .insert(invites)
      .values({ id: crypto.randomUUID(), groupId: me.groupId, ...invite, createdAt: now }),
  ]);
  return invite;
}

/** The live link any Member can share, or 404 when none is live. */
export async function currentInvite(db: Db, me: MemberRow, now: number): Promise<Invite> {
  const [row] = await db
    .select({ token: invites.token, expiresAt: invites.expiresAt })
    .from(invites)
    .where(and(eq(invites.groupId, me.groupId), gt(invites.expiresAt, now)))
    .orderBy(desc(invites.createdAt));
  if (row === undefined || row.expiresAt <= now) throw new ApiError("NOT_FOUND");
  return row;
}

/** Get or create a live invite without revoking one another member just shared. */
export async function ensureInvite(db: Db, me: MemberRow, now: number): Promise<Invite> {
  const id = crypto.randomUUID();
  const token = newToken();
  const expiresAt = now + INVITE_TTL_MS;
  await db.run(sql`INSERT INTO invites (id, group_id, token, expires_at, created_at)
    SELECT ${id}, ${me.groupId}, ${token}, ${expiresAt}, ${now}
    WHERE NOT EXISTS (SELECT 1 FROM invites WHERE group_id = ${me.groupId} AND expires_at > ${now})`);
  return currentInvite(db, me, now);
}

/** A live Invite's Group; a regenerated (deleted) link is 404, a lapsed one INVITE_EXPIRED. */
async function openInvite(db: Db, token: string, now: number) {
  const [row] = await db
    .select({ group: groups, expiresAt: invites.expiresAt })
    .from(invites)
    .innerJoin(groups, eq(groups.id, invites.groupId))
    .where(eq(invites.token, token));
  if (row === undefined) throw new ApiError("NOT_FOUND");
  if (row.expiresAt <= now) throw new ApiError("INVITE_EXPIRED");
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
  const { group, expiresAt } = await openInvite(db, token, now);
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
): Promise<JoinResult> {
  const { group } = await openInvite(db, token, now);
  await reserveGroup(env.DB, userId, group.id, now);
  const mine = await ownRow(db, group.id, userId);
  if (mine?.status === "active") return { groupId: group.id, memberId: mine.id };
  await assertUnderGroupCap(db, userId);
  const result = await memberOperation(env, group.id, {
    action: "join",
    userId,
    targetMemberId: mine?.id ?? crypto.randomUUID(),
    now,
  });
  return { groupId: group.id, memberId: result.memberId };
}

export async function claimPlaceholder(
  db: Db,
  token: string,
  userId: string,
  placeholderId: string,
  now: number,
  env: Bindings,
): Promise<JoinResult> {
  const { group } = await openInvite(db, token, now);
  if ((await ownRow(db, group.id, userId)) !== undefined) throw new ApiError("ALREADY_MEMBER");
  await assertUnderGroupCap(db, userId);
  await reserveGroup(env.DB, userId, group.id, now);
  const result = await memberOperation(env, group.id, {
    action: "claim",
    userId,
    targetMemberId: placeholderId,
    now,
  });
  return { groupId: group.id, memberId: result.memberId };
}
