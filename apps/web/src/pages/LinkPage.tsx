import { useState } from "react";
import { Navigate, useSearchParams } from "react-router";
import { useDeps } from "../app/AppProviders.js";
import { useAuth } from "../auth/AuthProvider.js";
import { GoogleButton } from "../auth/GoogleButton.js";
import { errorMessage, t } from "../i18n/messages.js";
import { Splash } from "../shell/Splash.js";

/**
 * Where the one-time link code from LINE's Settings lands, in the phone's own browser: a Google
 * sign-in here joins the User who asked for the code, instead of starting a new one.
 */
export function LinkPage() {
  const { line, google } = useDeps();
  const { state, redeemLinkCode, signOut } = useAuth();
  const code = useSearchParams()[0].get("code") ?? "";
  const [done, setDone] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);

  if (state.status === "loading") return <Splash />;
  if (done && state.status === "signedIn") return <Navigate to="/settings" replace />;
  const error =
    (state.status === "signedOut" ? state.error : null) ?? (openFailed ? "INTERNAL" : null);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pt-16 pb-8">
      <h1 className="text-3xl font-black">{t("link.title")}</h1>
      <p className="mt-3 text-ink-muted">{t("link.body")}</p>
      {error !== null && (
        <p role="alert" className="mt-6 rounded-2xl bg-peach px-4 py-3 text-sm">
          {errorMessage(error)}
        </p>
      )}
      <div className="mt-8">
        {line.isInClient() ? (
          // Google cannot sign in inside LINE's browser, and logging out here would not help.
          <>
            <p>{t("link.inLine")}</p>
            <button
              type="button"
              onClick={() => {
                setOpenFailed(false);
                line.openExternal(window.location.href).catch(() => {
                  setOpenFailed(true);
                });
              }}
              className="press-pill mt-4 rounded-full bg-sprout-600 px-5 py-2 font-bold text-white"
            >
              {t("signIn.googleExternalOpen")}
            </button>
          </>
        ) : state.status === "signedIn" && !done ? (
          // Switching Users under a live session is never done silently: log out first.
          <>
            <p>{t("link.signedIn")}</p>
            <button
              type="button"
              onClick={() => void signOut()}
              className="press-pill mt-4 rounded-full bg-sprout-600 px-5 py-2 font-bold text-white"
            >
              {t("link.signOut")}
            </button>
          </>
        ) : (
          google.available && (
            <GoogleButton
              label={t("signIn.google")}
              onIdToken={(idToken) => {
                void redeemLinkCode(code, idToken).then(() => {
                  setDone(true);
                });
              }}
            />
          )
        )}
      </div>
    </main>
  );
}
