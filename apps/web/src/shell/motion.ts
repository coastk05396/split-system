/** The device asks for less movement: slides, grows and count-ups switch to their end state. */
export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The ease-out every authored motion here shares: a quick start that settles gently. */
export const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
