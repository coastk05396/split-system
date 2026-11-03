import type { Bindings } from "../env.js";

const BATCH = 100;

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
        const response = await env.GROUP_LEDGER.get(
          env.GROUP_LEDGER.idFromName(task.group_id),
        ).fetch("https://ledger.internal/account-deletion", {
          method: "POST",
          body: JSON.stringify({
            action: "commit",
            userId: task.user_id,
            now: Date.now(),
            expires: task.expires_at,
          }),
        });
        if (!response.ok) continue;
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
