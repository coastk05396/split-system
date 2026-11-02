import { useEffect, useState } from "react";

export interface KeyboardInset {
  /** How far the on-screen keyboard reaches up from the bottom of the layout viewport. */
  inset: number;
  /** The height still visible above it. */
  height: number;
}

/** Follows the visual viewport, so a bottom sheet can sit above the keyboard instead of under it. */
export function useKeyboardInset(): KeyboardInset {
  const [state, setState] = useState<KeyboardInset>({ inset: 0, height: 0 });
  useEffect(() => {
    const viewport: VisualViewport | null | undefined = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      setState({
        inset: Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)),
        height: Math.round(viewport.height),
      });
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);
  return state;
}
