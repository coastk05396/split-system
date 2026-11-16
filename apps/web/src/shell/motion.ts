/** The device asks for less movement: slides, grows and count-ups switch to their end state. */
export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Smooth scrolling only when the user has not asked for reduced motion. */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}

/** Strong ease-out for entering and exiting UI chrome. */
export const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";

/** Strong ease-in-out for elements moving or morphing on screen. */
export const EASE_IN_OUT = "cubic-bezier(0.77, 0, 0.175, 1)";
