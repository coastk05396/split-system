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
    ON CONFLICT(user_id,group_id) DO UPDATE SET created_at=CASE WHEN group_reservations.status='pending' THEN excluded.created_at ELSE group_reservations.created_at END`,
    )
    .bind(userId, groupId, now, userId, userId, now, userId, MAX_GROUPS_PER_USER, userId, groupId)
    .run();
  if (result.meta.changes !== 1) {
    const blocked = await db
      .prepare("SELECT 1 AS found FROM account_deletions WHERE user_id=? AND expires_at>?")
      .bind(userId, now)
      .first();
    throw new ApiError(blocked ? "FORBIDDEN" : "GROUP_LIMIT_REACHED");
  }
}

/**
 * Whether a failed attempt certainly changed nothing: the ledger answered and refused. Anything
 * else (a dropped connection, a 5xx, a timeout) leaves it unknown whether the ledger committed.
 */
function isConfirmedRefusal(error: unknown): boolean {
  return error instanceof ApiError && error.status < 500;
}

/**
 * Runs `attempt` after reserving a seat. A reservation this call created is released when the
 * attempt is refused, so refused joins and claims never count toward the User's Group limit.
 *
 * A failure that is not a confirmed refusal may still have committed in the ledger, so the seat
 * is only released once `isSeated` reports the User is not in the Group; when it cannot say, the
 * reservation stays and the ledger projection settles it. Each attempt stamps `created_at` with
 * its own `now`, and a release only removes the row it stamped, so a concurrent attempt for the
 * same Group keeps the reservation it re-stamped.
 */
export async function withReservation<T>(
  db: D1Database,
  userId: string,
  groupId: string,
  now: number,
  attempt: () => Promise<T>,
  isSeated?: () => Promise<boolean>,
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
    if (!existed && (await canRelease(error, isSeated))) {
      await db
        .prepare(
          "DELETE FROM group_reservations WHERE user_id=? AND group_id=? AND status='pending' AND created_at=?",
        )
        .bind(userId, groupId, now)
        .run();
    }
    throw error;
  }
}

async function canRelease(error: unknown, isSeated?: () => Promise<boolean>): Promise<boolean> {
  if (isConfirmedRefusal(error)) return true;
  if (isSeated === undefined) return false;
  try {
    return !(await isSeated());
  } catch {
    return false;
  }
}
