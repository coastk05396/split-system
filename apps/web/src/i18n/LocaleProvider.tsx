import { Fragment, type ReactNode, useEffect, useSyncExternalStore } from "react";
import { useAuth } from "../auth/AuthProvider.js";
import { rememberLocale } from "./detect.js";
import { getLocale, setLocale, subscribeLocale } from "./messages.js";

/**
 * Keeps the app in the signed-in User's language, and draws the whole tree again when it
 * changes: `t()` reads the current language while rendering, so a new key remounts the pages.
 */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const locale = useSyncExternalStore(subscribeLocale, getLocale, getLocale);
  const saved = state.status === "signedIn" ? state.user.language : null;

  useEffect(() => {
    if (saved === null) return;
    setLocale(saved);
    rememberLocale(saved);
  }, [saved]);

  return <Fragment key={locale}>{children}</Fragment>;
}
