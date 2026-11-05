import { Link } from "react-router";
import { useGoogleErrand } from "../auth/google-errand.js";
import { errorMessage, t } from "../i18n/messages.js";
import { GoogleTransition } from "../auth/GoogleTransition.js";

/**
 * Where Google's account chooser sends the page back, with an ID token and the errand it was
 * asked for. Carries the errand out (sign in, link, or finish a link code) and moves on.
 */
export function GoogleReturnPage() {
  const errand = useGoogleErrand("return");
  if (errand.error === null) {
    return (
      <GoogleTransition>
        {t(errand.purpose === "signIn" ? "google.signingIn" : "google.linking")}
      </GoogleTransition>
    );
  }
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pt-16 pb-8">
      <p role="alert" className="rounded-2xl bg-peach px-4 py-3 text-sm">
        {errorMessage(errand.error)}
      </p>
      <Link
        to="/settings"
        replace
        className="press-pill mt-6 self-start rounded-full bg-sprout-600 px-5 py-2 font-bold text-white"
      >
        {t("common.back")}
      </Link>
    </main>
  );
}
