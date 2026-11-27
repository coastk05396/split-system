import type { Bindings } from "../env.js";
import { ApiError } from "../errors.js";
import { groupLedger } from "../ledger-client.js";

const BATCH = 100;
const MERGE_RETRY_DELAY_MS = 60 * 60 * 1000;

function cleanupErrorLog(event: string, operation: string, error: unknown): string {
  return JSON.stringify({
    event,
    operation,
    role: "maintenance",
    errorClass: error instanceof Error ? error.name : "UnknownError",
    ...(error instanceof ApiError ? { errorCode: error.code } : {}),
  });
}

/**
 * Tells each ledger that a deleted account is gone for good, so it drops the rollback copy it
 * kept, then forgets the task. A ledger that cannot be reached keeps its task for the next run
 * (the daily Cron Trigger calls this too). Never throws: the account is already deleted.
 */
export async function commitAccountCleanups(env: Bindings): Promise<void> {
  try {
    const { results } = await env.DB.prepare(
      "SELECT user_id,group_id,expires_at FROM account_cleanups LIMIT ?",
    )
      .bind(BATCH)
      .all<{ user_id: string; group_id: string; expires_at: number }>();
    for (const task of results) {
      try {
        // A refused commit throws, so the task stays for the next run.
        await groupLedger(env, task.group_id).accountDeletion({
          action: "commit",
          userId: task.user_id,
          now: Date.now(),
          expires: task.expires_at,
        });
        await env.DB.prepare("DELETE FROM account_cleanups WHERE user_id=? AND group_id=?")
          .bind(task.user_id, task.group_id)
          .run();
      } catch (error) {
        console.error(cleanupErrorLog("account_cleanup_failed", "account_cleanup_task", error));
      }
    }
  } catch (error) {
    console.error(cleanupErrorLog("account_cleanup_failed", "account_cleanup_queue", error));
  }
}

/**
 * Applies pending per-Group User repoints from a completed Merge to each Group's ledger, then
 * forgets each completed task. When `otherUserId` is given, only that Merge's tasks run so old
 * failing tasks cannot starve a new confirmation; during maintenance, failed tasks advance their
 * `next_retry_at` so healthy work further down the queue gets a turn. Never throws.
 */
export async function commitMergeCleanups(
  env: Bindings,
  now = Date.now(),
  otherUserId?: string,
): Promise<void> {
  try {
    const query =
      otherUserId === undefined
        ? env.DB.prepare(
            "SELECT kept_user_id,other_user_id,group_id,next_retry_at,pending_reservation_at FROM merge_cleanups ORDER BY next_retry_at ASC LIMIT ?",
          ).bind(BATCH)
        : env.DB.prepare(
            "SELECT kept_user_id,other_user_id,group_id,next_retry_at,pending_reservation_at FROM merge_cleanups WHERE other_user_id=? ORDER BY next_retry_at ASC LIMIT ?",
          ).bind(otherUserId, BATCH);
    const { results } = await query.all<{
      kept_user_id: string;
      other_user_id: string;
      group_id: string;
      next_retry_at: number;
      pending_reservation_at: number | null;
    }>();
    for (const task of results) {
      try {
        const ledger = groupLedger(env, task.group_id);
        await ledger.mergeUser({
          keptUserId: task.kept_user_id,
          otherUserId: task.other_user_id,
        });
        if (task.pending_reservation_at !== null && !(await ledger.isMember(task.kept_user_id))) {
          await env.DB.prepare(
            "DELETE FROM group_reservations WHERE user_id=? AND group_id=? AND status='pending' AND created_at=?",
          )
            .bind(task.kept_user_id, task.group_id, task.pending_reservation_at)
            .run();
        }
        await env.DB.prepare("DELETE FROM merge_cleanups WHERE other_user_id=? AND group_id=?")
          .bind(task.other_user_id, task.group_id)
          .run();
      } catch (error) {
        console.error(cleanupErrorLog("merge_cleanup_failed", "merge_cleanup_task", error));
        await env.DB.prepare(
          "UPDATE merge_cleanups SET next_retry_at=MAX(next_retry_at + 1, ?) WHERE other_user_id=? AND group_id=?",
        )
          .bind(now + MERGE_RETRY_DELAY_MS, task.other_user_id, task.group_id)
          .run()
          .catch(() => undefined);
      }
    }
  } catch (error) {
    console.error(cleanupErrorLog("merge_cleanup_failed", "merge_cleanup_queue", error));
  }
}

/** One-time reprojection of pre-0021 cold Groups so Former Members appear in group_memberships. */
export async function backfillGroupMemberships(env: Bindings, now = Date.now()): Promise<void> {
  try {
    const { results } = await env.DB.prepare(
      "SELECT group_id FROM group_directory WHERE deleted = 0 AND membership_reprojected = 0 ORDER BY membership_backfill_retry_at ASC, created_at ASC LIMIT ?",
    )
      .bind(BATCH)
      .all<{ group_id: string }>();
    if (results.length === 0) return;
    for (const row of results) {
      try {
        await groupLedger(env, row.group_id).projectMemberships();
      } catch (error) {
        console.error(cleanupErrorLog("membership_backfill_failed", "project_memberships", error));
        await env.DB.prepare(
          "UPDATE group_directory SET membership_backfill_retry_at = MAX(membership_backfill_retry_at + 1, ?) WHERE group_id = ?",
        )
          .bind(now + MERGE_RETRY_DELAY_MS, row.group_id)
          .run()
          .catch(() => undefined);
      }
    }
    const remaining = await env.DB.prepare(
      "SELECT count(*) AS n FROM group_directory WHERE deleted = 0 AND membership_reprojected = 0",
    ).first<{ n: number }>();
    const incompleteCount = remaining?.n ?? 0;
    if (incompleteCount > 0) {
      console.log(
        JSON.stringify({
          event: "membership_backfill_incomplete",
          role: "maintenance",
          incompleteCount,
        }),
      );
    }
  } catch (error) {
    console.error(
      cleanupErrorLog("membership_backfill_failed", "membership_backfill_queue", error),
    );
  }
}
