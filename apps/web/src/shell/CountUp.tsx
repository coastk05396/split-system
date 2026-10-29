import { useLayoutEffect, useRef } from "react";
import { prefersReducedMotion } from "./motion.js";

// Long enough to see the digits run, and a soft ease-out (not exponential, which is at 90% by
// the first third and reads as a jump) so the count is steady and only slows near the end.
const DURATION_MS = 1100;
const easeOut = (x: number) => 1 - (1 - Math.min(x, 1)) ** 2.4;

/**
 * A number that counts to its value: from 0 the first time it appears, from the old value after
 * that. The text is the final value from the first render (screen readers, tests, no script), and
 * the frames only rewrite it in between, so nothing is hidden if the animation never runs.
 */
export function CountUp({
  value,
  format,
  className = "",
  goodWhen = "up",
  onDark = false,
}: {
  value: number;
  format: (value: number) => string;
  className?: string;
  /** Which way is good news while it counts: more (up) or less (down), e.g. a shrinking debt. */
  goodWhen?: "up" | "down";
  /** On a dark card the tints are the light ones. */
  onDark?: boolean;
}) {
  const node = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(null);
  // A new inline `format` on every render must not restart the count, only a new value does.
  const formatRef = useRef(format);
  formatRef.current = format;

  useLayoutEffect(() => {
    const el = node.current;
    if (el === null) return;
    const fmt = (n: number) => formatRef.current(n);
    const from = shown.current ?? 0;
    if (from === value || prefersReducedMotion()) {
      shown.current = value;
      return;
    }

    let frame = 0;
    let current = from;
    // Green for good news, red for bad, only while the number is on the move.
    el.dataset.count = value > from === (goodWhen === "up") ? "good" : "bad";
    const start = performance.now();
    el.textContent = fmt(from);
    const step = (now: number) => {
      const progress = easeOut((now - start) / DURATION_MS);
      current = progress >= 1 ? value : Math.round(from + (value - from) * progress);
      el.textContent = fmt(current);
      if (progress < 1) frame = requestAnimationFrame(step);
      else {
        shown.current = value;
        delete el.dataset.count;
      }
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      // Stopped early (a new value, or StrictMode's trial run in development): the next count
      // starts from the number that was on screen, never from the target it never reached.
      shown.current = current;
      el.textContent = fmt(current);
      delete el.dataset.count;
    };
  }, [value]);

  return (
    <span ref={node} className={`count-up ${onDark ? "count-dark" : ""} ${className}`}>
      {format(value)}
    </span>
  );
}
