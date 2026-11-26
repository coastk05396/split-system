import type { Bindings } from "../env.js";
import { groupLedger } from "../ledger-client.js";

const BATCH = 100;
const MERGE_RETRY_DELAY_MS = 60 * 60 * 1000;

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
        console.error(JSON.stringify({ event: "account_cleanup_failed", error: String(error) }));
      }
    }
  } catch (error) {
    console.error(JSON.stringify({ event: "account_cleanup_failed", error: String(error) }));
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
            "SELECT kept_user_id,other_user_id,group_id,next_retry_at FROM merge_cleanups ORDER BY next_retry_at ASC LIMIT ?",
          ).bind(BATCH)
        : env.DB.prepare(
            "SELECT kept_user_id,other_user_id,group_id,next_retry_at FROM merge_cleanups WHERE other_user_id=? ORDER BY next_retry_at ASC LIMIT ?",
          ).bind(otherUserId, BATCH);
    const { results } = await query.all<{
      kept_user_id: string;
      other_user_id: string;
      group_id: string;
      next_retry_at: number;
    }>();
    for (const task of results) {
      try {
        await groupLedger(env, task.group_id).mergeUser({
          keptUserId: task.kept_user_id,
          otherUserId: task.other_user_id,
        });
        await env.DB.prepare("DELETE FROM merge_cleanups WHERE other_user_id=? AND group_id=?")
          .bind(task.other_user_id, task.group_id)
          .run();
      } catch (error) {
        console.error(JSON.stringify({ event: "merge_cleanup_failed", error: String(error) }));
        await env.DB.prepare(
          "UPDATE merge_cleanups SET next_retry_at=MAX(next_retry_at + 1, ?) WHERE other_user_id=? AND group_id=?",
        )
          .bind(now + MERGE_RETRY_DELAY_MS, task.other_user_id, task.group_id)
          .run()
          .catch(() => undefined);
      }
    }
  } catch (error) {
    console.error(JSON.stringify({ event: "merge_cleanup_failed", error: String(error) }));
  }
}
