import { ApiError } from "../errors.js";

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
    ON CONFLICT(user_id,group_id) DO UPDATE SET user_id=excluded.user_id`,
    )
    .bind(userId, groupId, now, userId, userId, now)
    .run();
  if (result.meta.changes !== 1) throw new ApiError("FORBIDDEN");
}
