/**
 * A deploy renames every built file, so a tab or webview still holding the old page asks for
 * files that no longer exist, and the server answers with the HTML page instead of JavaScript.
 * The cure is to load the new page, once.
 */
const RELOADED_AT_KEY = "split.reloadedForNewVersion";
/** A second failure this soon after a reload is a real problem, not a stale page. */
const RETRY_AFTER_MS = 10_000;

const STALE_FILE_MESSAGE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i;

export function isStaleFileError(error: unknown): boolean {
  return error instanceof Error && STALE_FILE_MESSAGE.test(error.message);
}

/** Whether a reload for a new version already happened a moment ago (or cannot be remembered). */
export function reloadedRecently(now: number = Date.now()): boolean {
  try {
    return now - Number(window.sessionStorage.getItem(RELOADED_AT_KEY)) < RETRY_AFTER_MS;
  } catch {
    // No session storage (a private window): without a guard, do not risk a loop.
    return true;
  }
}

/** Reloads to pick up the new version; false when it already did a moment ago, to never loop. */
export function reloadForNewVersion(
  now: number = Date.now(),
  reload: () => void = () => {
    window.location.reload();
  },
): boolean {
  if (reloadedRecently(now)) return false;
  window.sessionStorage.setItem(RELOADED_AT_KEY, String(now));
  reload();
  return true;
}
