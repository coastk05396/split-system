import { spring, useShouldReduceMotion, useTempoTransition } from "@animate-ui/react/utils/motion";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { Link } from "react-router";

const MotionLink = motion.create(Link);

/** A light, interruptible press response for links that occupy a whole card or row. */
export function PressableLink(props: { to: string; className: string; children: ReactNode }) {
  const reduceMotion = useShouldReduceMotion();
  const press = useTempoTransition(spring.press);

  return (
    <MotionLink
      initial={{ transform: "scale(1)" }}
      whileTap={{ transform: reduceMotion ? "scale(1)" : "scale(0.97)" }}
      transition={press}
      {...props}
    />
  );
}
