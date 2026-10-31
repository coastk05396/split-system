import { useLayoutEffect, useRef } from "react";
import { prefersReducedMotion } from "./motion.js";

// ADR 0004 & Ticket 10: Amounts never count step-by-step through guessed numbers.
// When an amount changes, the old amount fades out and the new amount slides in
// over ~240ms (120ms fade out, 120ms slide in). With reduced motion, it swaps instantly.
const TOTAL_MS = 240;
const HALF_MS = 120;

export function CountUp({
  value,
  format,
  className = "",
  goodWhen = "up",
  onDark = false,
  updating = false,
}: {
  value: number;
  format: (value: number) => string;
  className?: string;
  /** Which way is good news while it changes: more (up) or less (down), e.g. a shrinking debt. */
  goodWhen?: "up" | "down";
  /** On a dark card the tints are the light ones. */
  onDark?: boolean;
  /** True while the amount is restored from cache and awaiting server confirmation. */
  updating?: boolean | undefined;
}) {
  const node = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(null);
  const formatRef = useRef(format);
  formatRef.current = format;

  useLayoutEffect(() => {
    const el = node.current;
    if (el === null) return;
    const fmt = (n: number) => formatRef.current(n);
    const from = shown.current;

    // Initial mount or unchanged: show immediately without animation
    if (from === null || from === value || prefersReducedMotion()) {
      shown.current = value;
      el.textContent = fmt(value);
      return;
    }

    let frame = 0;
    // Green for good news, red for bad, only while the number transitions
    el.dataset.count = value > from === (goodWhen === "up") ? "good" : "bad";
    const start = performance.now();

    const step = (now: number) => {
      const elapsed = now - start;
      if (elapsed < HALF_MS) {
        // Phase 1: Old amount fades out
        const p = Math.min(1, elapsed / HALF_MS);
        el.textContent = fmt(from);
        el.style.opacity = String(1 - p);
        el.style.transform = `translateY(-${p * 4}px)`;
        frame = requestAnimationFrame(step);
      } else if (elapsed < TOTAL_MS) {
        // Phase 2: New amount slides in
        const p = Math.min(1, (elapsed - HALF_MS) / HALF_MS);
        el.textContent = fmt(value);
        el.style.opacity = String(p);
        el.style.transform = `translateY(${(1 - p) * 4}px)`;
        frame = requestAnimationFrame(step);
      } else {
        // Transition complete
        shown.current = value;
        el.textContent = fmt(value);
        el.style.opacity = "";
        el.style.transform = "";
        delete el.dataset.count;
      }
    };

    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      shown.current = value;
      el.textContent = fmt(value);
      el.style.opacity = "";
      el.style.transform = "";
      delete el.dataset.count;
    };
  }, [value, goodWhen]);

  return (
    <span
      ref={node}
      className={`count-up ${onDark ? "count-dark" : ""} ${className}`}
      data-updating={updating ? "true" : undefined}
    >
      {format(value)}
    </span>
  );
}
