import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n/messages.js";

/** The id of the element at the very end of the page that holds the sticky bar's spacer. */
export const STICKY_BAR_SLOT = "sticky-bar-slot";

/**
 * Thumb-reach bar fixed above the mobile tab bar. The spacer is as tall as the bar so the last content can always scroll clear of it. The bar sits
 * under the tab bar's layer so the Add button, which rises above the tab bar, is never cut off.
 */
export function StickyBar({
  children,
  label = t("flight.searchBar"),
}: {
  children: ReactNode;
  label?: string;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(96);
  useEffect(() => {
    const element = bar.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setHeight(element.offsetHeight);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  // The spacer goes where the page ends (the slot the page keeps last), not where the bar is
  // written in the tree; there it would push the content down instead of clearing the bottom.
  const spacerNode = <div aria-hidden="true" style={{ height }} />;
  const slot = document.getElementById(STICKY_BAR_SLOT);
  const spacer = slot ? createPortal(spacerNode, slot) : spacerNode;
  return (
    <>
      {spacer}
      <div
        ref={bar}
        data-sticky-bar=""
        role="region"
        aria-label={label}
        className="fr-dock fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-[9] md:bottom-0 md:left-60"
      >
        <div className="mx-auto w-full max-w-md md:max-w-5xl">{children}</div>
      </div>
    </>
  );
}
