import { type MePatch, type Me, type Provider, REFRESH_TOKEN_TTL_SECONDS } from "@split/shared";
import { and, asc, eq, lt, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { isConstraintError } from "../db/errors.js";
import { identities, sessions, users } from "../db/schema.js";
import { ApiError } from "../errors.js";
import type { Bindings } from "../env.js";
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
    preferredCurrency: user.preferredCurrency,
    language: user.language,
    identities: linked,
  };
}

/** Saves the settings a User changes themselves; new Groups start from the Preferred currency. */
export async function updateSettings(
  db: Db,
  userId: string,
  settings: MePatch,
  now: number,
): Promise<void> {
  await db
    .update(users)
    .set({ ...settings, updatedAt: now })
    .where(eq(users.id, userId));
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
  const existing = await findIdentity(db, identity.provider, identity.sub);
  if (existing !== undefined) {
    if (existing.userId === userId) return;
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

/** Freeze every reserved ledger before checking authoritative balances and admin roles. */
export async function deleteAccount(
  env: Bindings,
  userId: string,
  clock: () => number,
): Promise<void> {
  const now = clock();
  const expires = now + 10 * 60 * 1000;
  const mark = await env.DB.prepare(
    `INSERT INTO account_deletions(user_id,expires_at) VALUES (?,?)
    ON CONFLICT(user_id) DO UPDATE SET expires_at=excluded.expires_at WHERE account_deletions.expires_at <= ?`,
  )
    .bind(userId, expires, now)
    .run();
  if (mark.meta.changes !== 1) throw new ApiError("FORBIDDEN");
  const frozen: string[] = [];
  const operation = async (groupId: string, action: "freeze" | "unfreeze" | "finalize") => {
    const stub = env.GROUP_LEDGER.get(env.GROUP_LEDGER.idFromName(groupId));
    const response = await stub.fetch("https://ledger.internal/account-deletion", {
      method: "POST",
      body: JSON.stringify({ action, userId, now: clock(), expires }),
    });
    if (!response.ok) {
      const body: unknown = await response.json();
      if (
        action === "finalize" &&
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof body.error === "object" &&
        body.error !== null &&
        "code" in body.error
      ) {
        if (body.error.code === "LAST_ADMIN")
          throw new ApiError("LAST_ADMIN", { groupIds: [groupId] });
        if (body.error.code === "BALANCE_NOT_ZERO")
          throw new ApiError("BALANCE_NOT_ZERO", { groupIds: [groupId] });
      }
      throw new ApiError("INTERNAL");
    }
    return response;
  };
  try {
    const reservations = await env.DB.prepare(
      "SELECT group_id FROM group_reservations WHERE user_id=?",
    )
      .bind(userId)
      .all<{ group_id: string }>();
    const owing: string[] = [];
    const lastAdmin: string[] = [];
    for (const row of reservations.results) {
      // Include an attempted freeze in cleanup even if its response was lost.
      frozen.push(row.group_id);
      const response = await operation(row.group_id, "freeze");
      const check = await response.json<{ balance: number; lastAdmin: boolean }>();
      if (check.balance !== 0) owing.push(row.group_id);
      if (check.lastAdmin) lastAdmin.push(row.group_id);
    }
    if (owing.length > 0) throw new ApiError("BALANCE_NOT_ZERO", { groupIds: owing });
    if (lastAdmin.length > 0) throw new ApiError("LAST_ADMIN", { groupIds: lastAdmin });
    for (const groupId of frozen) await operation(groupId, "finalize");
    const finishNow = clock();
    const spending = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='personal_spending'",
    ).first();
    const guard =
      "EXISTS (SELECT 1 FROM account_deletions WHERE user_id=? AND expires_at=? AND expires_at>?)";
    const statements = [
      ...(spending === null
        ? []
        : [
            env.DB.prepare(`DELETE FROM personal_spending WHERE user_id=? AND ${guard}`).bind(
              userId,
              userId,
              expires,
              finishNow,
            ),
          ]),
      env.DB.prepare(`DELETE FROM group_reservations WHERE user_id=? AND ${guard}`).bind(
        userId,
        userId,
        expires,
        finishNow,
      ),
      env.DB.prepare(`DELETE FROM group_member_summary WHERE user_id=? AND ${guard}`).bind(
        userId,
        userId,
        expires,
        finishNow,
      ),
      env.DB.prepare(`DELETE FROM users WHERE id=? AND ${guard}`).bind(
        userId,
        userId,
        expires,
        finishNow,
      ),
      env.DB.prepare("DELETE FROM account_deletions WHERE user_id=? AND expires_at=?").bind(
        userId,
        expires,
      ),
    ];
    const results = await env.DB.batch(statements);
    if ((results.at(-2)?.meta.changes ?? 0) < 1) throw new ApiError("FORBIDDEN");
  } catch (error) {
    await Promise.allSettled(frozen.map((id) => operation(id, "unfreeze")));
    await env.DB.prepare("DELETE FROM account_deletions WHERE user_id=? AND expires_at=?")
      .bind(userId, expires)
      .run();
    throw error;
  }
}
