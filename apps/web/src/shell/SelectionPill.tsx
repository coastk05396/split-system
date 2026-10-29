import { useLayoutEffect, useRef } from "react";
import { EASE_OUT, prefersReducedMotion } from "./motion.js";

/** Where each pill last was, by its `layoutId`: the next one slides in from there. */
const lastBox = new Map<string, DOMRect>();

/**
 * The pill that marks the selected tab, drawn inside the selected tab's own box. It is rendered
 * by whichever tab is selected, so on mount it plays the move from the previous tab's box to
 * its own (a FLIP, with the Web Animations API), and under reduced motion it just appears.
 */
export function SelectionPill({ layoutId, className }: { layoutId: string; className: string }) {
  const node = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = node.current;
    if (el === null) return;
    const now = el.getBoundingClientRect();
    const before = lastBox.get(layoutId);
    lastBox.set(layoutId, now);
    if (before !== undefined && !prefersReducedMotion()) {
      const dx = before.left - now.left;
      const dy = before.top - now.top;
      const sx = now.width === 0 ? 1 : before.width / now.width;
      const sy = now.height === 0 ? 1 : before.height / now.height;
      if (dx !== 0 || dy !== 0 || sx !== 1 || sy !== 1) {
        el.animate(
          [
            {
              transformOrigin: "0 0",
              transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`,
            },
            { transformOrigin: "0 0", transform: "none" },
          ],
          { duration: 280, easing: EASE_OUT },
        );
      }
    }
    return () => {
      // Remember the box this pill left from; it may already be detached, so only a real one counts.
      const box = el.getBoundingClientRect();
      if (box.width > 0) lastBox.set(layoutId, box);
    };
  }, [layoutId]);

  return (
    <span ref={node} aria-hidden="true" className={`pointer-events-none absolute ${className}`} />
  );
}
