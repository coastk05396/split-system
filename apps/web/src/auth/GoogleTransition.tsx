import type { ReactNode } from "react";
import { GoogleG } from "./GoogleButton.js";

/**
 * The whole screen while the page is on its way to Google or has just come back: the coloured G
 * inside a ring in Google's four colours. It stands in for every in-between page, so nothing of
 * ours flashes by.
 */
export function GoogleTransition({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5" role="status">
      <span className="google-ring grid size-24 place-items-center rounded-full">
        <span className="grid size-[5.25rem] place-items-center rounded-full bg-white">
          <GoogleG className="size-10" />
        </span>
      </span>
      <p className="text-sm font-bold text-ink-muted">{children}</p>
    </div>
  );
}
