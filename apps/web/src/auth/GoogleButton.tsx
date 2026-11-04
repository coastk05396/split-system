import { ArrowRight, LoaderCircle } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useDeps } from "../app/AppProviders.js";

/** Google's own button stops at 40px tall; the hidden one is scaled to cover the 56px face. */
const SCALE = 1.4;

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
  dim = false,
  waiting = false,
}: {
  label: ReactNode;
  dim?: boolean;
  /** Google's account chooser is opening: the arrow gives way to a spinner. */
  waiting?: boolean;
}) {
  return (
    <span
      className={`flex h-14 w-full items-center justify-between rounded-full border border-[#747775] bg-white px-[23px] text-base font-medium text-[#1F1F1F] transition-opacity ${
        dim ? "opacity-60" : ""
      }`}
    >
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

/**
 * Our own face over Google's real button, which sits on top, invisible, and takes the click:
 * the ID token still comes from Google's script. Hands it to `onIdToken` (sign-in or linking).
 */
export function GoogleButton({
  label,
  onIdToken,
  compact = false,
}: {
  label: ReactNode;
  onIdToken: (idToken: string) => void;
  /** A small pill (a row's action) instead of the full-width button. */
  compact?: boolean;
}) {
  const { google } = useDeps();
  const container = useRef<HTMLDivElement>(null);
  const callback = useRef(onIdToken);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [waiting, setWaiting] = useState(false);

  // Google's button is an iframe: the tap never reaches this page, but focus moves into it and the
  // window blurs. That is the only sign the chooser is opening; focus coming back ends the wait.
  useEffect(() => {
    const onBlur = () => {
      if (container.current?.contains(document.activeElement) === true) setWaiting(true);
    };
    const onFocus = () => {
      setWaiting(false);
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  useEffect(() => {
    callback.current = onIdToken;
  });

  useEffect(() => {
    const element = container.current;
    if (element === null) return;
    let active = true;
    google
      .renderButton(element, (idToken) => {
        if (!active) return;
        setWaiting(false);
        callback.current(idToken);
      })
      .then(() => {
        if (active) setStatus("ready");
      })
      .catch(() => {
        if (active) setStatus("failed");
      });
    return () => {
      active = false;
      element.replaceChildren();
    };
  }, [google]);

  // The real button sits on top at opacity 0.01, not 0: Google ignores finger taps on a fully
  // transparent one (Android Chrome), while 0.01 is invisible and works.
  // A face with nothing behind it would look like a button that does nothing.
  if (status === "failed") return null;
  if (compact) {
    return (
      <div
        data-google-button=""
        aria-busy={waiting}
        className={`relative shrink-0 rounded-full focus-within:ring-2 focus-within:ring-sprout-500 focus-within:ring-offset-2 ${
          waiting ? "google-pop" : status === "ready" ? "google-glow" : ""
        }`}
      >
        <span
          className={`flex min-h-11 items-center gap-1.5 rounded-full bg-sprout-600 px-5 text-sm font-bold text-white ${
            status === "loading" ? "opacity-60" : ""
          }`}
        >
          {waiting && (
            <LoaderCircle
              aria-hidden="true"
              className="size-4 animate-spin motion-reduce:animate-none"
            />
          )}
          {label}
        </span>
        <div ref={container} className="absolute inset-0 overflow-hidden opacity-[0.01]" />
      </div>
    );
  }
  return (
    <div
      data-google-button=""
      aria-busy={waiting}
      className={`rise group relative h-14 rounded-full focus-within:ring-2 focus-within:ring-sprout-500 focus-within:ring-offset-2 ${
        waiting ? "google-pop" : status === "ready" ? "google-glow" : ""
      }`}
    >
      <GoogleFace label={label} dim={status === "loading"} waiting={waiting} />
      <div className="absolute inset-0 overflow-hidden opacity-[0.01]">
        <div
          ref={container}
          style={{ width: `${String(100 / SCALE)}%`, transform: `scale(${String(SCALE)})` }}
          className="origin-top-left"
        />
      </div>
    </div>
  );
}
