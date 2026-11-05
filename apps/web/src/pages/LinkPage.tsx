import { useSearchParams } from "react-router";
import { useDeps } from "../app/AppProviders.js";
import { useAuth } from "../auth/AuthProvider.js";
import { useGoogleErrand } from "../auth/google-errand.js";
import { GoogleButton } from "../auth/GoogleButton.js";
import { errorMessage, t } from "../i18n/messages.js";
import { GoogleTransition } from "../auth/GoogleTransition.js";

/**
 * Where the one-time link code from LINE's Settings lands, in the phone's own browser: a Google
 * sign-in here joins the User who asked for the code, instead of starting a new one.
 */
export function LinkPage() {
  const { line, google } = useDeps();
  const { state, signOut } = useAuth();
  const code = useSearchParams()[0].get("code") ?? "";
  const errand = useGoogleErrand({ purpose: "linkCode", code });

  if (state.status === "loading" || (!line.isInClient() && errand.phase === "leaving")) {
    return <GoogleTransition>{t("settings.linkingGoogle")}</GoogleTransition>;
  }
  const error = (state.status === "signedOut" ? state.error : null) ?? errand.error;

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
                errand.clearError();
                void errand.start({ purpose: "linkCode", code });
              }}
              className="press-pill mt-4 rounded-full bg-sprout-600 px-5 py-2 font-bold text-white"
            >
              {t("signIn.googleExternalOpen")}
            </button>
          </>
        ) : state.status === "signedIn" ? (
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
            <GoogleButton label={t("signIn.google")} errand={{ purpose: "linkCode", code }} />
          )
        )}
      </div>
    </main>
  );
}
