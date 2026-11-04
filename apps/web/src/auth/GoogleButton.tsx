import { ArrowRight, LoaderCircle } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useDeps } from "../app/AppProviders.js";
import { t } from "../i18n/messages.js";
import type { GoogleErrand } from "../platform/google.js";

/** Google's colour "G" (its branding guidelines allow no recolouring or stretching). */
export function GoogleG({ className = "size-5" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className={className}>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

/** The look shared by every Google entry, laid out like the LINE button above it. */
export function GoogleFace({
  label,
  waiting = false,
}: {
  label: ReactNode;
  /** Google's account chooser is opening: the arrow gives way to a spinner. */
  waiting?: boolean;
}) {
  return (
    <span className="google-face flex h-14 w-full items-center justify-between rounded-full px-[22px] text-base font-medium text-[#1F1F1F]">
      <span className="flex items-center gap-2">
        <GoogleG />
        {label}
      </span>
      {waiting ? (
        <LoaderCircle
          aria-hidden="true"
          className="size-5 animate-spin motion-reduce:animate-none"
        />
      ) : (
        <ArrowRight
          aria-hidden="true"
          className="size-5 transition-transform duration-300 ease-(--ease-spring) group-hover:translate-x-1 motion-reduce:transition-none"
        />
      )}
    </span>
  );
}

/** A Google entry that is a row's action: the same face as the full-width button, in a pill. */
export const GOOGLE_PILL =
  "press-pill press-deep google-face flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-5 text-sm font-bold text-[#1F1F1F]";

/**
 * Our own button, so a press shrinks it at once. It sends the page to Google's account chooser;
 * `errand` says what the answer is for, and `/google-return` carries it out.
 */
export function GoogleButton({
  label,
  errand,
  compact = false,
}: {
  label: ReactNode;
  errand: GoogleErrand;
  /** A small pill (a row's action) instead of the full-width button. */
  compact?: boolean;
}) {
  const { google } = useDeps();
  const [going, setGoing] = useState(false);

  // Back from Google can restore this page as it was left, spinner and all.
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => {
      if (event.persisted) setGoing(false);
    };
    window.addEventListener("pageshow", reset);
    return () => {
      window.removeEventListener("pageshow", reset);
    };
  }, []);

  const shown = going ? t("settings.linkingGoogle") : label;
  const go = () => {
    setGoing(true);
    google.redirect(errand);
  };
  if (compact) {
    return (
      <button type="button" disabled={going} aria-busy={going} onClick={go} className={GOOGLE_PILL}>
        {going ? (
          <LoaderCircle
            aria-hidden="true"
            className="size-4 animate-spin motion-reduce:animate-none"
          />
        ) : (
          <GoogleG className="size-4" />
        )}
        {shown}
      </button>
    );
  }
  return (
    <button
      type="button"
      disabled={going}
      aria-busy={going}
      onClick={go}
      className="press-pill press-deep rise group block w-full rounded-full text-left"
    >
      <GoogleFace label={shown} waiting={going} />
    </button>
  );
}
