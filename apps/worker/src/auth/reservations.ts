import { ApiError } from "../errors.js";
import { MAX_GROUPS_PER_USER } from "@split/shared";

/** Reserve atomically against an account deletion mark. */
export async function reserveGroup(
  db: D1Database,
  userId: string,
  groupId: string,
  now: number,
): Promise<void> {
  const result = await db
    .prepare(
      `INSERT INTO group_reservations(user_id,group_id,status,created_at)
    SELECT ?,?,'pending',? WHERE EXISTS (SELECT 1 FROM users WHERE id=?) AND NOT EXISTS
      (SELECT 1 FROM account_deletions WHERE user_id=? AND expires_at>?)
      AND ((SELECT count(*) FROM group_reservations WHERE user_id=?) < ? OR EXISTS
        (SELECT 1 FROM group_reservations WHERE user_id=? AND group_id=?))
    ON CONFLICT(user_id,group_id) DO UPDATE SET user_id=excluded.user_id`,
    )
    .bind(userId, groupId, now, userId, userId, now, userId, MAX_GROUPS_PER_USER, userId, groupId)
    .run();
  if (result.meta.changes !== 1) {
    const blocked = await db.prepare("SELECT 1 AS found FROM account_deletions WHERE user_id=? AND expires_at>?").bind(userId,now).first();
    throw new ApiError(blocked ? "FORBIDDEN" : "GROUP_LIMIT_REACHED");
  }
}

/**
 * Runs `attempt` after reserving a seat. A reservation this call created is released when the
 * attempt fails, so refused joins and claims never count toward the User's Group limit.
 */
export async function withReservation<T>(
  db: D1Database,
  userId: string,
  groupId: string,
  now: number,
  attempt: () => Promise<T>,
): Promise<T> {
  const existed =
    (await db
      .prepare("SELECT 1 AS found FROM group_reservations WHERE user_id=? AND group_id=?")
      .bind(userId, groupId)
      .first()) !== null;
  await reserveGroup(db, userId, groupId, now);
  try {
    return await attempt();
  } catch (error) {
    if (!existed) {
      await db
        .prepare(
          "DELETE FROM group_reservations WHERE user_id=? AND group_id=? AND status='pending'",
        )
        .bind(userId, groupId)
        .run();
    }
    throw error;
  }
}
