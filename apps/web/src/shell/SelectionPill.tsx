import { spring, useShouldReduceMotion, useTempoTransition } from "@animate-ui/react/utils/motion";
import { motion } from "motion/react";

/**
 * The pill that slides to the selected tab, drawn inside the selected tab's own box. It is the
 * one place for the motion hooks and the reduced-motion rule (no `layoutId`, so no sliding), so
 * the bottom bar, the sidebar and the group tabs move the same way.
 */
export function SelectionPill({ layoutId, className }: { layoutId: string; className: string }) {
  const reduceMotion = useShouldReduceMotion();
  const selection = useTempoTransition(spring.selection);
  return (
    <motion.span
      aria-hidden="true"
      {...(reduceMotion ? {} : { layoutId })}
      transition={selection}
      className={`pointer-events-none absolute ${className}`}
    />
  );
}
