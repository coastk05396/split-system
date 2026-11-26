import {
  type MePatch,
  type Me,
  LINK_CODE_TTL_MS,
  MERGE_PENDING_TTL_MS,
  type MergePath,
  type MergePreview,
  type MergeUserPreview,
  type Provider,
  REFRESH_TOKEN_TTL_SECONDS,
  SESSION_MAX_AGE_SECONDS,
} from "@split/shared";
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { isConstraintError } from "../db/errors.js";
import { identities, linkCodes, pendingMerges, sessions, users } from "../db/schema.js";
import { ApiError } from "../errors.js";
import { commitAccountCleanups, commitMergeCleanups } from "./account-cleanup.js";
import type { Bindings } from "../env.js";
import { groupLedger } from "../ledger-client.js";
import type { VerifiedIdentity } from "./identity-verifier.js";
import {
  base64url,
  hashSecret,
  newRefreshToken,
  readRefreshToken,
  type RefreshToken,
} from "./tokens.js";

const REFRESH_TTL_MS = REFRESH_TOKEN_TTL_SECONDS * 1000;
const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_SECONDS * 1000;

/** The idle window renews at each use, but never runs past the session's absolute limit. */
const sessionEnd = (signedInAt: number, now: number): number =>
  Math.min(now + REFRESH_TTL_MS, signedInAt + SESSION_MAX_AGE_MS);
const MAX_USER_AGENT_LENGTH = 200;

/** The signed-in User as `GET /me` shows them, or null when the account is gone. */
export async function loadMe(
  db: Db,
  userId: string,
  /** What this session signed in with; null for older sessions, which fall back to the User's last. */
  signedInWith: Provider | null,
): Promise<Me | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (user === undefined) return null;
  const linked = await db
    .select({ provider: identities.provider, email: identities.email })
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
    signedInWith: signedInWith ?? user.lastProvider ?? linked[0]?.provider ?? "line",
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
 * later ones refresh the name and picture only when they come from the User's first Identity.
 */
export async function signInIdentity(
  db: Db,
  identity: VerifiedIdentity,
  now: number,
): Promise<string> {
  const existing = await findIdentity(db, identity.provider, identity.sub);
  if (existing !== undefined) {
    // Name and picture follow the User's first Identity (the Profile source).
    const [source] = await db
      .select({ provider: identities.provider })
      .from(identities)
      .where(eq(identities.userId, existing.userId))
      .orderBy(asc(identities.createdAt), asc(identities.provider))
      .limit(1);
    const isSource = source?.provider === identity.provider;
    await db
      .update(users)
      .set({
        ...(isSource ? { displayName: identity.displayName, pictureUrl: identity.pictureUrl } : {}),
        updatedAt: now,
      })
      .where(eq(users.id, existing.userId));
    if (identity.email !== null) {
      await db
        .update(identities)
        .set({ email: identity.email })
        .where(
          and(eq(identities.provider, identity.provider), eq(identities.providerSub, identity.sub)),
        );
    }
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
        email: identity.email,
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
  provider: Provider,
  userAgent: string | undefined,
  now: number,
): Promise<RefreshToken> {
  const refresh = await newRefreshToken(crypto.randomUUID());
  await db.insert(sessions).values({
    id: refresh.sessionId,
    userId,
    provider,
    refreshTokenHash: refresh.hash,
    userAgent: userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
    expiresAt: sessionEnd(now, now),
    createdAt: now,
  });
  return refresh;
}

/**
 * Rotates a refresh token: the presented one stops working and a new one is returned.
 * A token whose session exists but whose secret no longer matches was already rotated, so
 * someone is replaying it: the whole session is revoked, which also signs out whoever
 * holds the newer token. A lapsed session never rotates, and none outlives its 15 days since
 * sign-in; the daily run purges its row.
 */
export async function rotateSession(
  db: Db,
  presented: string,
  now: number,
): Promise<{
  userId: string;
  provider: Provider | null;
  sessionId: string;
  refresh: RefreshToken;
} | null> {
  const parsed = await readRefreshToken(presented);
  if (parsed === null) return null;
  const [session] = await db.select().from(sessions).where(eq(sessions.id, parsed.sessionId));
  if (session === undefined) return null;

  const refresh = await newRefreshToken(session.id);
  const [rotated] = await db
    .update(sessions)
    .set({ refreshTokenHash: refresh.hash, expiresAt: sessionEnd(session.createdAt, now) })
    .where(
      and(
        eq(sessions.id, session.id),
        eq(sessions.refreshTokenHash, parsed.hash),
        gt(sessions.expiresAt, now),
        // Rows made before the cap existed can still have an expiry far ahead.
        gt(sessions.createdAt, now - SESSION_MAX_AGE_MS),
      ),
    )
    .returning({ userId: sessions.userId, provider: sessions.provider });
  if (rotated === undefined) {
    await db.delete(sessions).where(eq(sessions.id, session.id));
    return null;
  }
  return { userId: rotated.userId, provider: rotated.provider, sessionId: session.id, refresh };
}

/** Ends the session a refresh token belongs to, if the token is still its current one. */
export async function endSession(db: Db, presented: string): Promise<void> {
  const parsed = await readRefreshToken(presented);
  if (parsed === null) return;
  await db
    .delete(sessions)
    .where(and(eq(sessions.id, parsed.sessionId), eq(sessions.refreshTokenHash, parsed.hash)));
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
      email: identity.email,
      createdAt: now,
    });
  } catch (error) {
    if (isConstraintError(error, "UNIQUE")) throw new ApiError("IDENTITY_LINKED_ELSEWHERE");
    throw error;
  }
}

/** Issues the User's one link code (replacing any earlier one); only its hash is stored. */
export async function createLinkCode(db: Db, userId: string, now: number): Promise<string> {
  const code = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const values = { codeHash: await hashSecret(code), userId, expiresAt: now + LINK_CODE_TTL_MS };
  await db
    .insert(linkCodes)
    .values(values)
    .onConflictDoUpdate({ target: linkCodes.userId, set: values });
  return code;
}

export type RedeemLinkCodeOutcome =
  | { mergeNeeded: false; userId: string }
  | {
      mergeNeeded: true;
      keptUserId: string;
      keptProvider: Provider;
      otherUserId: string;
      otherProvider: Provider;
      otherEmail: string | null;
    };

/**
 * Spends a link code and attaches the verified Identity to its User, or detects when that
 * Identity already belongs to another User so the caller can confirm a Merge.
 * The code is spent even when linking then fails, so a retry needs a fresh code.
 */
export async function redeemLinkCode(
  db: Db,
  code: string,
  identity: VerifiedIdentity,
  now: number,
): Promise<RedeemLinkCodeOutcome> {
  const [spent] = await db
    .delete(linkCodes)
    .where(and(eq(linkCodes.codeHash, await hashSecret(code)), gt(linkCodes.expiresAt, now)))
    .returning({ userId: linkCodes.userId });
  if (spent === undefined) throw new ApiError("LINK_CODE_INVALID");
  const existing = await findIdentity(db, identity.provider, identity.sub);
  if (existing !== undefined && existing.userId !== spent.userId) {
    const [primary] = await db
      .select({ provider: identities.provider })
      .from(identities)
      .where(eq(identities.userId, spent.userId))
      .orderBy(asc(identities.createdAt), asc(identities.provider))
      .limit(1);
    return {
      mergeNeeded: true,
      keptUserId: spent.userId,
      keptProvider: primary?.provider ?? "line",
      otherUserId: existing.userId,
      otherProvider: identity.provider,
      otherEmail: identity.email,
    };
  }
  await linkIdentity(db, spent.userId, identity, now);
  // The redeeming Google sign-in is the User's latest, so the profile follows it.
  return { mergeNeeded: false, userId: await signInIdentity(db, identity, now) };
}

async function loadMergeUserSide(
  db: Db,
  userId: string,
  otherGroupIds: ReadonlySet<string>,
): Promise<MergeUserPreview | null> {
  const [user] = await db
    .select({ id: users.id, displayName: users.displayName, pictureUrl: users.pictureUrl })
    .from(users)
    .where(eq(users.id, userId));
  if (user === undefined) return null;
  const linked = await db
    .select({ provider: identities.provider })
    .from(identities)
    .where(eq(identities.userId, userId))
    .orderBy(asc(identities.createdAt), asc(identities.provider));
  const groups = await db.all<{ id: string; name: string; merging: number }>(
    sql`SELECT d.group_id AS id, d.name,
        EXISTS (SELECT 1 FROM merge_cleanups mc WHERE mc.group_id = d.group_id) AS merging
        FROM group_directory d
        JOIN group_member_summary m ON m.group_id = d.group_id
        WHERE m.user_id = ${userId} AND d.deleted = 0
        ORDER BY d.created_at DESC, d.group_id DESC`,
  );
  return {
    id: user.id,
    displayName: user.displayName,
    pictureUrl: user.pictureUrl,
    providers: linked.map((l) => l.provider),
    profileProvider: linked[0]?.provider ?? "line",
    groupCount: groups.length,
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      shared: otherGroupIds.has(g.id),
      ...(g.merging === 1 ? { merging: true } : {}),
    })),
  };
}

async function userGroupIds(db: Db, userId: string): Promise<Set<string>> {
  const rows = await db.all<{ id: string }>(
    sql`SELECT d.group_id AS id
        FROM group_directory d
        JOIN group_member_summary m ON m.group_id = d.group_id
        WHERE m.user_id = ${userId} AND d.deleted = 0`,
  );
  return new Set(rows.map((r) => r.id));
}

async function buildMergePreview(
  db: Db,
  mergeId: string,
  path: MergePath,
  keptUserId: string,
  otherUserId: string,
  expiresAt: number,
): Promise<MergePreview | null> {
  const [keptIds, otherIds] = await Promise.all([
    userGroupIds(db, keptUserId),
    userGroupIds(db, otherUserId),
  ]);
  const [kept, other] = await Promise.all([
    loadMergeUserSide(db, keptUserId, otherIds),
    loadMergeUserSide(db, otherUserId, keptIds),
  ]);
  if (kept === null || other === null) return null;
  return { mergeId, path, expiresAt, kept, other };
}

/** Records a short-lived, single-use pending Merge bound to the confirming Session. */
export async function createPendingMerge(
  db: Db,
  params: {
    keptUserId: string;
    otherUserId: string;
    sessionId: string;
    path: MergePath;
    otherProvider: Provider;
    otherEmail: string | null;
    now: number;
  },
): Promise<MergePreview> {
  const mergeId = crypto.randomUUID();
  const expiresAt = params.now + MERGE_PENDING_TTL_MS;
  await db.insert(pendingMerges).values({
    id: mergeId,
    keptUserId: params.keptUserId,
    otherUserId: params.otherUserId,
    sessionId: params.sessionId,
    path: params.path,
    otherProvider: params.otherProvider,
    otherEmail: params.otherEmail,
    expiresAt,
    createdAt: params.now,
  });
  const preview = await buildMergePreview(
    db,
    mergeId,
    params.path,
    params.keptUserId,
    params.otherUserId,
    expiresAt,
  );
  if (preview === null) throw new ApiError("MERGE_PENDING_INVALID");
  return preview;
}

/** Cancels and deletes a pending Merge belonging to the confirming Session. */
export async function cancelMerge(
  db: Db,
  userId: string,
  sessionId: string | null,
  mergeId: string,
): Promise<void> {
  if (sessionId === null) return;
  await db
    .delete(pendingMerges)
    .where(
      and(
        eq(pendingMerges.id, mergeId),
        eq(pendingMerges.keptUserId, userId),
        eq(pendingMerges.sessionId, sessionId),
      ),
    );
}

/** Claims a single-use pending Merge for this Session and checks refusal preconditions. */
export async function claimPendingMerge(
  env: Bindings,
  db: Db,
  userId: string,
  sessionId: string | null,
  mergeId: string,
  now: number,
) {
  if (sessionId === null) throw new ApiError("MERGE_PENDING_INVALID");
  const [claimed] = await db
    .delete(pendingMerges)
    .where(
      and(
        eq(pendingMerges.id, mergeId),
        eq(pendingMerges.keptUserId, userId),
        eq(pendingMerges.sessionId, sessionId),
        gt(pendingMerges.expiresAt, now),
      ),
    )
    .returning();
  if (claimed === undefined) throw new ApiError("MERGE_PENDING_INVALID");
  const deleting = await env.DB.prepare(
    "SELECT 1 AS found FROM account_deletions WHERE user_id IN (?,?) AND expires_at > ? LIMIT 1",
  )
    .bind(claimed.keptUserId, claimed.otherUserId, now)
    .first();
  if (deleting !== null) throw new ApiError("MERGE_ACCOUNT_DELETION_PENDING");
  const [keptRows, otherRows] = await Promise.all([
    db
      .select({ provider: identities.provider })
      .from(identities)
      .where(eq(identities.userId, claimed.keptUserId)),
    db
      .select({ provider: identities.provider })
      .from(identities)
      .where(eq(identities.userId, claimed.otherUserId)),
  ]);
  if (keptRows.length === 0 || otherRows.length === 0) throw new ApiError("MERGE_PENDING_INVALID");
  const keptSet = new Set(keptRows.map((r) => r.provider));
  if (otherRows.some((r) => keptSet.has(r.provider))) {
    throw new ApiError("MERGE_SAME_PROVIDER");
  }
  return claimed;
}

/** Folds `otherUser` into `keptUser` in D1, ends `otherUser`'s Sessions, and repoints each Group ledger. */
export async function confirmMerge(
  env: Bindings,
  db: Db,
  userId: string,
  sessionId: string | null,
  mergeId: string,
  now: number,
): Promise<{ userId: string; provider: Provider; mergingGroupIds: string[] }> {
  const claimed = await claimPendingMerge(env, db, userId, sessionId, mergeId, now);
  if (sessionId === null) throw new ApiError("MERGE_PENDING_INVALID");
  const { keptUserId, otherUserId, otherProvider, otherEmail } = claimed;

  const affected = await env.DB.prepare(
    "SELECT group_id FROM group_reservations WHERE user_id=? UNION SELECT group_id FROM group_member_summary WHERE user_id=?",
  )
    .bind(otherUserId, otherUserId)
    .all<{ group_id: string }>();
  const groupIds = affected.results.map((r) => r.group_id);

  const guard =
    "EXISTS (SELECT 1 FROM users WHERE id=?) AND EXISTS (SELECT 1 FROM users WHERE id=?) AND NOT EXISTS (SELECT 1 FROM account_deletions WHERE user_id IN (?,?) AND expires_at>?)";
  const guardArgs = [keptUserId, otherUserId, keptUserId, otherUserId, now];
  const expires = now + MERGE_PENDING_TTL_MS;

  const statements = [
    // Keep moved Identities strictly newer than keptUser's existing ones so Profile source never shifts.
    env.DB.prepare(
      `UPDATE identities SET user_id=?, created_at=MAX(created_at, COALESCE((SELECT MAX(created_at) FROM identities WHERE user_id=?), 0) + 1), email=CASE WHEN provider=? AND ? IS NOT NULL THEN ? ELSE email END WHERE user_id=? AND ${guard}`,
    ).bind(
      keptUserId,
      keptUserId,
      otherProvider,
      otherEmail,
      otherEmail,
      otherUserId,
      ...guardArgs,
    ),
    env.DB.prepare(`UPDATE sessions SET provider=? WHERE id=? AND user_id=? AND ${guard}`).bind(
      otherProvider,
      sessionId,
      keptUserId,
      ...guardArgs,
    ),
    env.DB.prepare(`DELETE FROM sessions WHERE user_id=? AND ${guard}`).bind(
      otherUserId,
      ...guardArgs,
    ),
    env.DB.prepare(`DELETE FROM link_codes WHERE user_id=? AND ${guard}`).bind(
      otherUserId,
      ...guardArgs,
    ),
    env.DB.prepare(`DELETE FROM account_deletions WHERE user_id=? AND ${guard}`).bind(
      otherUserId,
      ...guardArgs,
    ),
    env.DB.prepare(
      `UPDATE OR IGNORE personal_spending SET user_id=? WHERE user_id=? AND ${guard}`,
    ).bind(keptUserId, otherUserId, ...guardArgs),
    env.DB.prepare(`DELETE FROM personal_spending WHERE user_id=? AND ${guard}`).bind(
      otherUserId,
      ...guardArgs,
    ),
    env.DB.prepare(
      `UPDATE OR IGNORE group_reservations SET user_id=? WHERE user_id=? AND ${guard}`,
    ).bind(keptUserId, otherUserId, ...guardArgs),
    env.DB.prepare(`DELETE FROM group_reservations WHERE user_id=? AND ${guard}`).bind(
      otherUserId,
      ...guardArgs,
    ),
    env.DB.prepare(
      `UPDATE OR IGNORE group_member_summary SET user_id=? WHERE user_id=? AND ${guard}`,
    ).bind(keptUserId, otherUserId, ...guardArgs),
    env.DB.prepare(`DELETE FROM group_member_summary WHERE user_id=? AND ${guard}`).bind(
      otherUserId,
      ...guardArgs,
    ),
    env.DB.prepare(`DELETE FROM users WHERE id=? AND ${guard}`).bind(otherUserId, ...guardArgs),
  ];
  const deleteUserIndex = statements.length - 1;
  const cleanups = groupIds.map((groupId) =>
    env.DB.prepare(
      "INSERT OR IGNORE INTO merge_cleanups(kept_user_id,other_user_id,group_id,expires_at) SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM users WHERE id=?)",
    ).bind(keptUserId, otherUserId, groupId, expires, otherUserId),
  );
  const results = await env.DB.batch([...statements, ...cleanups]);
  if ((results[deleteUserIndex]?.meta.changes ?? 0) < 1) {
    throw new ApiError("MERGE_ACCOUNT_DELETION_PENDING");
  }
  await commitMergeCleanups(env, now);
  const remaining =
    groupIds.length === 0
      ? []
      : (
          await env.DB.prepare("SELECT group_id FROM merge_cleanups WHERE other_user_id=?")
            .bind(otherUserId)
            .all<{ group_id: string }>()
        ).results.map((r) => r.group_id);
  return { userId: keptUserId, provider: otherProvider, mergingGroupIds: remaining };
}

/** Reads the current Session's active pending Merge preview without consuming it. */
export async function getPendingMerge(
  db: Db,
  userId: string,
  sessionId: string | null,
  now: number,
): Promise<MergePreview> {
  if (sessionId === null) throw new ApiError("MERGE_PENDING_INVALID");
  const [row] = await db
    .select()
    .from(pendingMerges)
    .where(
      and(
        eq(pendingMerges.keptUserId, userId),
        eq(pendingMerges.sessionId, sessionId),
        gt(pendingMerges.expiresAt, now),
      ),
    )
    .orderBy(desc(pendingMerges.createdAt))
    .limit(1);
  if (row === undefined) throw new ApiError("MERGE_PENDING_INVALID");
  const preview = await buildMergePreview(
    db,
    row.id,
    row.path,
    row.keptUserId,
    row.otherUserId,
    row.expiresAt,
  );
  if (preview === null) throw new ApiError("MERGE_PENDING_INVALID");
  return preview;
}

/** Freeze every reserved ledger before checking authoritative balances and admin roles. */
export async function deleteAccount(
  env: Bindings,
  userId: string,
  clock: () => number,
): Promise<void> {
  const merging = await env.DB.prepare(
    "SELECT 1 AS found FROM merge_cleanups WHERE kept_user_id=? LIMIT 1",
  )
    .bind(userId)
    .first();
  if (merging !== null) throw new ApiError("GROUP_MERGING");
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
  const finalized: string[] = [];
  const operation = async <A extends "freeze" | "unfreeze" | "finalize" | "restore">(
    groupId: string,
    action: A,
  ) => {
    try {
      return (
        await groupLedger(env, groupId).accountDeletion({ action, userId, now: clock(), expires })
      ).value;
    } catch (error) {
      if (
        action === "finalize" &&
        error instanceof ApiError &&
        (error.code === "LAST_ADMIN" || error.code === "BALANCE_NOT_ZERO")
      )
        throw new ApiError(error.code, { groupIds: [groupId] });
      throw new ApiError("INTERNAL");
    }
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
      const check = await operation(row.group_id, "freeze");
      if (check.balance !== 0) owing.push(row.group_id);
      if (check.lastAdmin) lastAdmin.push(row.group_id);
    }
    if (owing.length > 0) throw new ApiError("BALANCE_NOT_ZERO", { groupIds: owing });
    if (lastAdmin.length > 0) throw new ApiError("LAST_ADMIN", { groupIds: lastAdmin });
    for (const groupId of frozen) {
      // Counted before the call: a lost response may still have finalised this Group.
      finalized.push(groupId);
      await operation(groupId, "finalize");
    }
    const finishNow = clock();
    const guard =
      "EXISTS (SELECT 1 FROM account_deletions WHERE user_id=? AND expires_at=? AND expires_at>?)";
    const deletes = [
      env.DB.prepare(`DELETE FROM personal_spending WHERE user_id=? AND ${guard}`).bind(
        userId,
        userId,
        expires,
        finishNow,
      ),
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
    ];
    // Written in the same batch, and only once the User row is really gone, so a ledger that
    // keeps a rollback copy is always cleaned up later even if the next call to it fails.
    const cleanups = frozen.map((groupId) =>
      env.DB.prepare(
        "INSERT OR IGNORE INTO account_cleanups(user_id,group_id,expires_at) SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM users WHERE id=?)",
      ).bind(userId, groupId, expires, userId),
    );
    const results = await env.DB.batch([
      ...deletes,
      ...cleanups,
      env.DB.prepare("DELETE FROM account_deletions WHERE user_id=? AND expires_at=?").bind(
        userId,
        expires,
      ),
    ]);
    if ((results[deletes.length - 1]?.meta.changes ?? 0) < 1) throw new ApiError("FORBIDDEN");
    await commitAccountCleanups(env);
  } catch (error) {
    // Two phases across Groups: a finalised Group is put back before any Group is unfrozen, so
    // a deletion that fails midway never leaves the User a Former Member of only some Groups.
    await Promise.allSettled(finalized.map((id) => operation(id, "restore")));
    await Promise.allSettled(frozen.map((id) => operation(id, "unfreeze")));
    await env.DB.prepare("DELETE FROM account_deletions WHERE user_id=? AND expires_at=?")
      .bind(userId, expires)
      .run();
    throw error;
  }
}
