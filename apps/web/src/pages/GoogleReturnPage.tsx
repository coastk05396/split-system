import type { Me } from "@split/shared";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { createApiClient, withJson } from "../api/client.js";
import { type ErrorCode, toApiFailure } from "../api/errors.js";
import { useDeps } from "../app/AppProviders.js";
import { useAuth } from "../auth/AuthProvider.js";
import { errorMessage, t } from "../i18n/messages.js";
import type { GoogleErrand } from "../platform/google.js";
import { Splash } from "../shell/Splash.js";

/** The page the errand started from: where a refusal or a failure puts the person back. */
function origin(errand: GoogleErrand): string {
  if (errand.purpose === "signIn") return `/sign-in?next=${encodeURIComponent(errand.next)}`;
  if (errand.purpose === "link") return "/settings";
  return `/link?code=${encodeURIComponent(errand.code)}`;
}

/**
 * Where Google's account chooser sends the page back, with an ID token and the errand it was
 * asked for. Carries the errand out (sign in, link, or finish a link code) and moves on.
 */
export function GoogleReturnPage() {
  const { google } = useDeps();
  const { state, session, signIn, redeemLinkCode, updateUser } = useAuth();
  const navigate = useNavigate();
  // Read once: taking the result also clears the token from the address.
  const [result] = useState(() => google.takeRedirectResult());
  const [failure, setFailure] = useState<ErrorCode | null>(null);
  const [after, setAfter] = useState<GoogleErrand | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (state.status === "loading" || started.current) return;
    started.current = true;
    if (result === null) {
      void navigate("/sign-in", { replace: true });
      return;
    }
    const { errand, idToken } = result;
    if (idToken === null) {
      void navigate(origin(errand), { replace: true });
      return;
    }
    void (async () => {
      if (errand.purpose === "signIn") await signIn("google", idToken);
      else if (errand.purpose === "linkCode") await redeemLinkCode(errand.code, idToken);
      else {
        try {
          const res: Response = await createApiClient(session.fetch).auth.link[":provider"].$post(
            { param: { provider: "google" } },
            withJson({ idToken }),
          );
          if (!res.ok) {
            setFailure((await toApiFailure(res)).code);
            return;
          }
          updateUser((await res.json()) as Me);
        } catch {
          setFailure("INTERNAL");
          return;
        }
      }
      setAfter(errand);
    })();
    // Once per arrival: the token is single-use.
  }, [state.status]);

  // Sign-in and link-code leave the answer in the auth state: signed in goes on, an error goes
  // back to the page that shows it.
  useEffect(() => {
    if (after === null) return;
    const signedIn = state.status === "signedIn";
    if (after.purpose === "link") void navigate("/settings", { replace: true });
    else if (after.purpose === "linkCode") {
      void navigate(signedIn ? "/settings" : origin(after), { replace: true });
    } else void navigate(origin(after), { replace: true });
  }, [after, state.status, navigate]);

  if (failure === null) return <Splash />;
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pt-16 pb-8">
      <p role="alert" className="rounded-2xl bg-peach px-4 py-3 text-sm">
        {errorMessage(failure)}
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
