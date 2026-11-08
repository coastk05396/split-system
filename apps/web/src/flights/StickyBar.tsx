import { useEffect, useRef, useState, type ReactNode } from "react";
import { t } from "../i18n/messages.js";

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
  return (
    <>
      <div aria-hidden="true" style={{ height }} />
      <div
        ref={bar}
        role="region"
        aria-label={label}
        className="glass-nav fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-[9] border-t border-sprout-200/80 py-3 pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] md:bottom-0 md:left-60"
      >
        <div className="mx-auto w-full max-w-md md:max-w-5xl">{children}</div>
      </div>
    </>
  );
}
