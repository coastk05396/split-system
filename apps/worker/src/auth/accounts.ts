import {
  DELETED_USER_NAME,
  type Me,
  type Provider,
  REFRESH_TOKEN_TTL_SECONDS,
} from "@split/shared";
import { and, asc, eq, inArray, lt, ne, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { isConstraintError } from "../db/errors.js";
import { groups, identities, members, sessions, users } from "../db/schema.js";
import { ApiError } from "../errors.js";
import type { VerifiedIdentity } from "./identity-verifier.js";
import { newRefreshToken, readRefreshToken, type RefreshToken } from "./tokens.js";

const REFRESH_TTL_MS = REFRESH_TOKEN_TTL_SECONDS * 1000;
const MAX_USER_AGENT_LENGTH = 200;

/** The signed-in User as `GET /me` shows them, or null when the account is gone. */
export async function loadMe(db: Db, userId: string): Promise<Me | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (user === undefined) return null;
  const linked = await db
    .select({ provider: identities.provider })
    .from(identities)
    .where(eq(identities.userId, userId))
    .orderBy(asc(identities.createdAt), asc(identities.provider));
  return {
    id: user.id,
    displayName: user.displayName,
    pictureUrl: user.pictureUrl,
    identities: linked,
  };
}

/**
 * Signs a verified Identity in: the first sign-in creates the User with that one Identity;
 * later ones refresh the name and picture from the provider used most recently.
 */
export async function signInIdentity(
  db: Db,
  identity: VerifiedIdentity,
  now: number,
): Promise<string> {
  const existing = await findIdentity(db, identity.provider, identity.sub);
  if (existing !== undefined) {
    await db
      .update(users)
      .set({ displayName: identity.displayName, pictureUrl: identity.pictureUrl, updatedAt: now })
      .where(eq(users.id, existing.userId));
    return existing.userId;
  }
  const userId = crypto.randomUUID();
  try {
    await db.batch([
      db.insert(users).values({
        id: userId,
        displayName: identity.displayName,
        pictureUrl: identity.pictureUrl,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(identities).values({
        id: crypto.randomUUID(),
        userId,
        provider: identity.provider,
        providerSub: identity.sub,
        createdAt: now,
      }),
    ]);
    return userId;
  } catch (error) {
    // A concurrent first sign-in created the User; the batch rolled back, so use theirs.
    if (!isConstraintError(error, "UNIQUE")) throw error;
    const winner = await findIdentity(db, identity.provider, identity.sub);
    if (winner === undefined) throw error;
    return winner.userId;
  }
}

async function findIdentity(db: Db, provider: Provider, sub: string) {
  const [row] = await db
    .select({ userId: identities.userId })
    .from(identities)
    .where(and(eq(identities.provider, provider), eq(identities.providerSub, sub)));
  return row;
}

/** Starts a device session and returns its refresh token. */
export async function createSession(
  db: Db,
  userId: string,
  userAgent: string | undefined,
  now: number,
): Promise<RefreshToken> {
  const refresh = await newRefreshToken(crypto.randomUUID());
  await db.insert(sessions).values({
    id: refresh.sessionId,
    userId,
    refreshTokenHash: refresh.hash,
    userAgent: userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
    expiresAt: now + REFRESH_TTL_MS,
    createdAt: now,
  });
  return refresh;
}

/**
 * Rotates a refresh token: the presented one stops working and a new one is returned.
 * A token whose session exists but whose secret no longer matches was already rotated, so
 * someone is replaying it: the whole session is revoked, which also signs out whoever
 * holds the newer token. Expired sessions are purged here.
 */
export async function rotateSession(
  db: Db,
  presented: string,
  now: number,
): Promise<{ userId: string; refresh: RefreshToken } | null> {
  await db.delete(sessions).where(lt(sessions.expiresAt, now));
  const parsed = await readRefreshToken(presented);
  if (parsed === null) return null;
  const [session] = await db.select().from(sessions).where(eq(sessions.id, parsed.sessionId));
  if (session === undefined) return null;

  const refresh = await newRefreshToken(session.id);
  const [rotated] = await db
    .update(sessions)
    .set({ refreshTokenHash: refresh.hash, expiresAt: now + REFRESH_TTL_MS })
    .where(and(eq(sessions.id, session.id), eq(sessions.refreshTokenHash, parsed.hash)))
    .returning({ userId: sessions.userId });
  if (rotated === undefined) {
    await db.delete(sessions).where(eq(sessions.id, session.id));
    return null;
  }
  return { userId: rotated.userId, refresh };
}

/** Ends the session a refresh token belongs to, if the token is still its current one. */
export async function endSession(db: Db, presented: string): Promise<void> {
  const parsed = await readRefreshToken(presented);
  if (parsed === null) return;
  await db
    .delete(sessions)
    .where(and(eq(sessions.id, parsed.sessionId), eq(sessions.refreshTokenHash, parsed.hash)));
}

export async function endAllSessions(db: Db, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/** Adds a second Identity to a signed-in User. Users are never merged. */
export async function linkIdentity(
  db: Db,
  userId: string,
  identity: VerifiedIdentity,
  now: number,
): Promise<void> {
  const owner = await findIdentity(db, identity.provider, identity.sub);
  if (owner !== undefined) {
    if (owner.userId === userId) return;
    throw new ApiError("IDENTITY_LINKED_ELSEWHERE");
  }
  const [sameProvider] = await db
    .select({ id: identities.id })
    .from(identities)
    .where(and(eq(identities.userId, userId), eq(identities.provider, identity.provider)));
  if (sameProvider !== undefined) throw new ApiError("PROVIDER_ALREADY_LINKED");
  try {
    await db.insert(identities).values({
      id: crypto.randomUUID(),
      userId,
      provider: identity.provider,
      providerSub: identity.sub,
      createdAt: now,
    });
  } catch (error) {
    if (isConstraintError(error, "UNIQUE")) throw new ApiError("IDENTITY_LINKED_ELSEWHERE");
    throw error;
  }
}

/** Removes one Identity, refusing when it is the User's last; checked in the same statement. */
export async function unlinkIdentity(db: Db, userId: string, provider: Provider): Promise<void> {
  const removed = await db
    .delete(identities)
    .where(
      and(
        eq(identities.userId, userId),
        eq(identities.provider, provider),
        sql`(SELECT count(*) FROM ${identities} WHERE ${identities.userId} = ${userId}) > 1`,
      ),
    )
    .returning({ id: identities.id });
  if (removed.length > 0) return;
  const [kept] = await db
    .select({ id: identities.id })
    .from(identities)
    .where(and(eq(identities.userId, userId), eq(identities.provider, provider)));
  throw new ApiError(kept === undefined ? "NOT_FOUND" : "LAST_IDENTITY");
}

/**
 * Deletes an account (decisions 15 and 26). Refused while any Balance is not zero, or while
 * the User is the last admin of a Group that still has other active Members. Groups where
 * the User is the only active Member are deleted with everything under them. Every other
 * Member row stays as a Former Member named "已刪除的使用者"; identities, sessions, the
 * name and the picture go with the User row.
 */
export async function deleteAccount(db: Db, userId: string): Promise<void> {
  const memberships = await db
    .select({ groupId: members.groupId, role: members.role, netBalance: members.netBalance })
    .from(members)
    .where(and(eq(members.userId, userId), eq(members.status, "active")));

  const owing = memberships.filter((m) => m.netBalance !== 0).map((m) => m.groupId);
  if (owing.length > 0) throw new ApiError("BALANCE_NOT_ZERO", { groupIds: owing });

  const groupIds = memberships.map((m) => m.groupId);
  const others =
    groupIds.length === 0
      ? []
      : await db
          .select({ groupId: members.groupId, role: members.role })
          .from(members)
          .where(
            and(
              inArray(members.groupId, groupIds),
              eq(members.status, "active"),
              ne(members.userId, userId),
            ),
          );

  const soloGroups: string[] = [];
  const lastAdminOf: string[] = [];
  for (const membership of memberships) {
    const rest = others.filter((o) => o.groupId === membership.groupId);
    if (rest.length === 0) soloGroups.push(membership.groupId);
    else if (membership.role === "admin" && !rest.some((o) => o.role === "admin")) {
      lastAdminOf.push(membership.groupId);
    }
  }
  if (lastAdminOf.length > 0) throw new ApiError("LAST_ADMIN", { groupIds: lastAdminOf });

  await db.batch([
    db.delete(groups).where(inArray(groups.id, soloGroups.length === 0 ? [""] : soloGroups)),
    db
      .update(members)
      .set({ status: "former", nickname: DELETED_USER_NAME })
      .where(eq(members.userId, userId)),
    db.delete(users).where(eq(users.id, userId)),
  ]);
}
