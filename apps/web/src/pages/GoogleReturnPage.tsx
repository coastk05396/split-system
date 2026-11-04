import type { Me } from "@split/shared";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { createApiClient, withJson } from "../api/client.js";
import { type ErrorCode, toApiFailure } from "../api/errors.js";
import { useDeps } from "../app/AppProviders.js";
import { useAuth } from "../auth/AuthProvider.js";
import { errorMessage, t } from "../i18n/messages.js";
import type { GoogleErrand } from "../platform/google.js";
import { GoogleTransition } from "../auth/GoogleTransition.js";

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
  // The arrival's answer is dropped if the page closed while it was on its way.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

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
    // A link code never replaces a live session (W-8): back to /link, whose log-out wall asks first.
    if (errand.purpose === "linkCode" && state.status === "signedIn") {
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
            const code = (await toApiFailure(res)).code;
            if (mounted.current) setFailure(code);
            return;
          }
          updateUser((await res.json()) as Me);
        } catch {
          if (mounted.current) setFailure("INTERNAL");
          return;
        }
      }
      if (mounted.current) setAfter(errand);
    })();
    // Once per arrival: the token is single-use (`started`).
  }, [state, result, navigate, session, signIn, redeemLinkCode, updateUser]);

  // Sign-in and link-code leave the answer in the auth state: signed in goes on, an error goes
  // back to the page that shows it.
  useEffect(() => {
    if (after === null) return;
    const signedIn = state.status === "signedIn";
    // `linked` tells Settings which account was just joined, so its mark pops in once.
    const linked = { state: { linked: "google" }, replace: true };
    if (after.purpose === "link") void navigate("/settings", linked);
    else if (after.purpose === "linkCode") {
      void navigate(signedIn ? "/settings" : origin(after), signedIn ? linked : { replace: true });
    } else void navigate(origin(after), { replace: true });
  }, [after, state.status, navigate]);

  if (failure === null) {
    const signingIn = result?.errand.purpose === "signIn";
    return (
      <GoogleTransition>{t(signingIn ? "google.signingIn" : "google.linking")}</GoogleTransition>
    );
  }
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
