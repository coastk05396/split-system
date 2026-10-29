import { ArrowRight, MessageCircle } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { Link } from "react-router";
import { useDeps } from "../app/AppProviders.js";
import { useAuth } from "../auth/AuthProvider.js";
import { GoogleButton } from "../auth/GoogleButton.js";
import { errorMessage, t } from "../i18n/messages.js";
import { SproutMark } from "../shell/SproutMark.js";

const TestSignInForm = lazy(() =>
  import("./TestSignInForm.js").then((m) => ({ default: m.TestSignInForm })),
);

/** Screen 1 (歡迎登入) with the decision 29 data summary above the consent line. */
export function SignInPage() {
  const { line, google, testSignIn } = useDeps();
  const { state, signIn } = useAuth();
  const [lineError, setLineError] = useState(false);
  const insideLine = line.isInClient();
  const error = state.status === "signedOut" ? state.error : null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pt-16 pb-8">
      <div className="flex justify-end">
        <SproutMark className="size-28" />
      </div>
      <h1 className="mt-8 text-4xl leading-tight font-black whitespace-pre-line">
        {t("signIn.title").split("，").join("，\n")}
      </h1>
      <p className="mt-3 text-ink-muted">{t("signIn.body")}</p>

      {(error !== null || lineError) && (
        <p role="alert" className="mt-6 rounded-2xl bg-peach px-4 py-3 text-sm">
          {errorMessage(error ?? "INTERNAL")}
        </p>
      )}

      <div className="mt-auto flex flex-col gap-3 pt-10">
        <button
          type="button"
          onClick={() => {
            setLineError(false);
            line.login().catch(() => {
              setLineError(true);
            });
          }}
          className="flex items-center justify-between rounded-full bg-line px-6 py-4 font-bold text-white hover:brightness-95"
        >
          <span className="flex items-center gap-2">
            <MessageCircle aria-hidden="true" className="size-5" />
            {t("signIn.line")}
          </span>
          <ArrowRight aria-hidden="true" className="size-5" />
        </button>
        {!insideLine && google.available && (
          <GoogleButton onIdToken={(idToken) => void signIn("google", idToken)} />
        )}
      </div>

      {testSignIn && (
        <Suspense fallback={null}>
          <TestSignInForm />
        </Suspense>
      )}

      <footer className="mt-8 text-center text-xs leading-relaxed text-ink-muted">
        <p>{t("signIn.dataSummary1")}</p>
        <p>{t("signIn.dataSummary2")}</p>
        <p className="mt-3">
          {t("signIn.consentBefore")}
          <Link to="/terms" className="underline">
            {t("signIn.terms")}
          </Link>
          {t("signIn.consentJoin")}
          <Link to="/privacy" className="underline">
            {t("signIn.privacy")}
          </Link>
        </p>
      </footer>
    </main>
  );
}
