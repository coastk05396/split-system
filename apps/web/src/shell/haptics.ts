/**
 * Safely triggers a light haptic vibration tick on devices supporting the Vibration API.
 * Gracefully returns false in non-browser environments or when unsupported/blocked.
 */
export function hapticTick(ms = 15): boolean {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    try {
      return navigator.vibrate(ms);
    } catch {
      return false;
    }
  }
  return false;
}
