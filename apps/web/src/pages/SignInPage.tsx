import * as Dialog from "@radix-ui/react-dialog";
import { ArrowRight, MessageCircle } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { Link } from "react-router";
import { useDeps } from "../app/AppProviders.js";
import { useAuth } from "../auth/AuthProvider.js";
import { GoogleButton, GoogleFace } from "../auth/GoogleButton.js";
import { errorMessage, t } from "../i18n/messages.js";
import { SproutMascot } from "../shell/SproutMascot.js";

const TestSignInForm = lazy(() =>
  import("./TestSignInForm.js").then((m) => ({ default: m.TestSignInForm })),
);

/** Screen 1 (歡迎登入) with the decision 29 data summary above the consent line. */
export function SignInPage() {
  const { line, google, testSignIn } = useDeps();
  const { state, signIn } = useAuth();
  const [lineError, setLineError] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const insideLine = line.isInClient();
  const error = state.status === "signedOut" ? state.error : null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pt-16 pb-8">
      <div className="flex justify-end">
        <SproutMascot className="size-32" />
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
          className="press-pill flex items-center justify-between rounded-full bg-line px-6 py-4 font-bold text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_6px_14px_-8px_#06c755] hover:brightness-95"
        >
          <span className="flex items-center gap-2">
            <MessageCircle aria-hidden="true" className="size-5" />
            {t("signIn.line")}
          </span>
          <ArrowRight aria-hidden="true" className="size-5" />
        </button>
        {!insideLine && google.available && (
          <GoogleButton
            label={t("signIn.google")}
            onIdToken={(idToken) => void signIn("google", idToken)}
          />
        )}
        {insideLine && google.available && (
          // Google refuses LINE's browser: the same button explains and offers the outside one.
          <Dialog.Root open={explaining} onOpenChange={setExplaining}>
            <Dialog.Trigger asChild>
              <button type="button" className="press-pill block w-full rounded-full text-left">
                <GoogleFace label={t("signIn.google")} />
              </button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="dialog-overlay glass-overlay fixed inset-0 z-20" />
              <Dialog.Content className="dialog-content glass-dialog fixed inset-x-0 bottom-0 z-30 flex flex-col gap-4 rounded-t-[2rem] border-t border-sprout-200/80 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-ink md:inset-x-4 md:top-1/2 md:bottom-auto md:mx-auto md:max-w-md md:-translate-y-1/2 md:rounded-3xl md:border md:p-6">
                <Dialog.Title className="text-lg font-bold">
                  {t("signIn.googleExternalTitle")}
                </Dialog.Title>
                <Dialog.Description className="text-sm text-ink-muted">
                  {t("signIn.googleExternalBody")}
                </Dialog.Description>
                <div className="flex gap-3">
                  <Dialog.Close className="press-pill flex-1 rounded-full border border-sprout-200 py-3 font-bold hover:border-sprout-500">
                    {t("signIn.googleExternalCancel")}
                  </Dialog.Close>
                  <button
                    type="button"
                    onClick={() => {
                      setExplaining(false);
                      void line.openExternal(window.location.href);
                    }}
                    className="press-pill flex-1 rounded-full bg-sprout-600 py-3 font-bold text-white hover:bg-sprout-600/90"
                  >
                    {t("signIn.googleExternalOpen")}
                  </button>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
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
