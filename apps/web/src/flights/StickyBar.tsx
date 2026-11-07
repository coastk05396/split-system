import type { ReactNode } from "react";
import { t } from "../i18n/messages.js";

/**
 * Thumb-reach bar fixed above the mobile tab bar. The spacer keeps the last content clear of it;
 * the tab bar already handles the bottom safe-area inset.
 */
export function StickyBar({ children }: { children: ReactNode }) {
  return (
    <>
      <div aria-hidden="true" className="h-24" />
      <div
        role="region"
        aria-label={t("flight.searchBar")}
        className="glass-nav fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-20 border-t border-sprout-200/80 py-3 pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] md:bottom-0 md:left-60"
      >
        <div className="mx-auto w-full max-w-md md:max-w-5xl">{children}</div>
      </div>
    </>
  );
}
