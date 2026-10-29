import { useEffect, useRef, useState } from "react";
import { useDeps } from "../app/AppProviders.js";
import { t } from "../i18n/messages.js";

/** Google's own button; hands its ID token to `onIdToken` (sign-in or linking). */
export function GoogleButton({ onIdToken }: { onIdToken: (idToken: string) => void }) {
  const { google } = useDeps();
  const container = useRef<HTMLDivElement>(null);
  const callback = useRef(onIdToken);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    callback.current = onIdToken;
  });

  useEffect(() => {
    const element = container.current;
    if (element === null) return;
    let active = true;
    google
      .renderButton(element, (idToken) => {
        if (active) callback.current(idToken);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      element.replaceChildren();
    };
  }, [google]);

  return (
    <div className="flex min-h-12 items-center justify-center">
      {loading && <p className="text-sm text-ink-muted">{t("signIn.googleLoading")}</p>}
      <div ref={container} />
    </div>
  );
}
