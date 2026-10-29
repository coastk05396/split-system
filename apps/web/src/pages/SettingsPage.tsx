import { CURRENCY_CODES, LANGUAGES, PROVIDERS, type Me, type Provider } from "@split/shared";
import { ChevronRight, FileText, Link2, LogOut, ShieldCheck, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import { createApiClient, withJson } from "../api/client.js";
import { type ErrorCode, toApiFailure } from "../api/errors.js";
import { useDeps } from "../app/AppProviders.js";
import { useAuth } from "../auth/AuthProvider.js";
import { GoogleButton } from "../auth/GoogleButton.js";
import { Avatar } from "../groups/ui.js";
import { errorMessage, getLocale, t } from "../i18n/messages.js";

const PROVIDER_NAME: Record<Provider, string> = { line: "LINE", google: "Google" };

const card = "surface-card rounded-3xl border border-sprout-200 bg-white";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="mt-8">
      <h2 className="mb-3 text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}

/**
 * Screen 11 (設定與帳號) as changed by docs/design-changes.md: no 通知提醒; the 偏好幣別
 * (Preferred currency) sits right under the profile; linked Identities with link and unlink, 登出所有裝置, 刪除帳號, and the policy links.
 */
export function SettingsPage() {
  const { state, session, signOut, updateUser } = useAuth();
  const { line, google } = useDeps();
  const [error, setError] = useState<ErrorCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (state.status !== "signedIn") return null;
  const user = state.user;
  const api = createApiClient(session.fetch);
  const linked = new Set(user.identities.map((identity) => identity.provider));
  const insideLine = line.isInClient();

  /** Runs one account call; on failure shows its zh-TW message. */
  async function run(call: () => Promise<Response>, onOk: (res: Response) => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      const res = await call();
      if (res.ok) await onOk(res);
      else setError((await toApiFailure(res)).code);
    } catch {
      setError("INTERNAL");
    } finally {
      setBusy(false);
    }
  }

  const acceptMe = async (res: Response) => {
    updateUser((await res.json()) as Me);
  };

  /** Ends this device's session too; the Gate then shows the landing page. */
  const leave = () => signOut();

  function link(provider: Provider, idToken: string) {
    void run(
      () => api.auth.link[":provider"].$post({ param: { provider } }, withJson({ idToken })),
      acceptMe,
    );
  }

  function linkLine() {
    void line.autoSignIn().then((idToken) => {
      if (idToken === null) setError("ID_TOKEN_INVALID");
      else link("line", idToken);
    });
  }

  function linkControl(provider: Provider): ReactNode {
    if (provider === "google") {
      return google.available ? (
        <GoogleButton
          onIdToken={(idToken) => {
            link("google", idToken);
          }}
        />
      ) : null;
    }
    return insideLine ? (
      <button
        type="button"
        disabled={busy}
        onClick={linkLine}
        className="press-pill rounded-full bg-line px-4 py-2 text-sm font-bold text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25)] hover:bg-line/90"
      >
        {t("settings.link", { provider: PROVIDER_NAME.line })}
      </button>
    ) : (
      <p className="text-sm text-ink-muted">{t("settings.lineLinkHint")}</p>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-3xl font-black">{t("settings.heading")}</h1>

      <div className={`${card} line-bubble-card mt-6 flex items-center gap-4 p-5`}>
        <Avatar
          name={user.displayName}
          pictureUrl={user.pictureUrl}
          className="size-16 text-2xl ring-2 ring-sprout-200"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-xl font-bold">{user.displayName}</p>
            {linked.has("line") && (
              <span
                aria-hidden="true"
                className="rounded-full bg-line px-2 py-0.5 text-[11px] font-bold tracking-wide text-white"
              >
                LINE
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-ink-muted">
            {t("settings.linkedVia", {
              providers: user.identities
                .map((i) => PROVIDER_NAME[i.provider])
                .join(getLocale() === "en" ? ", " : "、"),
            })}
          </p>
        </div>
      </div>

      <Section title={t("settings.currencySection")}>
        <select
          aria-label={t("settings.currencySection")}
          value={user.preferredCurrency}
          disabled={busy}
          onChange={(e) => {
            const code = CURRENCY_CODES.find((c) => c === e.target.value);
            if (code === undefined || code === user.preferredCurrency) return;
            void run(() => api.me.$patch({}, withJson({ preferredCurrency: code })), acceptMe);
          }}
          className="w-full rounded-2xl border border-sprout-200 bg-white px-4 py-3 outline-none focus:border-sprout-500"
        >
          {CURRENCY_CODES.map((code) => (
            <option key={code} value={code}>
              {t(`currency.${code}`)}
            </option>
          ))}
        </select>
        <p className="mt-2 px-1 text-sm text-ink-muted">{t("settings.currencyHint")}</p>
      </Section>

      {error !== null && (
        <p role="alert" className="mt-6 rounded-2xl bg-peach px-4 py-3 text-sm">
          {errorMessage(error)}
        </p>
      )}

      <Section title={t("settings.languageSection")}>
        <select
          aria-label={t("settings.languageSection")}
          value={user.language}
          disabled={busy}
          onChange={(e) => {
            const language = LANGUAGES.find((l) => l === e.target.value);
            if (language === undefined || language === user.language) return;
            void run(() => api.me.$patch({}, withJson({ language })), acceptMe);
          }}
          className="w-full rounded-2xl border border-sprout-200 bg-white px-4 py-3 outline-none focus:border-sprout-500"
        >
          {LANGUAGES.map((language) => (
            <option key={language} value={language}>
              {t(`language.${language}`)}
            </option>
          ))}
        </select>
        <p className="mt-2 px-1 text-sm text-ink-muted">{t("settings.languageHint")}</p>
      </Section>

      <Section title={t("settings.privacySection")}>
        <ul className={`${card} divide-y divide-sprout-150`}>
          {(
            [
              ["/privacy", ShieldCheck, "settings.privacy"],
              ["/terms", FileText, "settings.terms"],
            ] as const
          ).map(([to, Icon, label]) => (
            <li key={to}>
              <Link to={to} className="flex items-center gap-3 px-5 py-4 font-bold">
                <Icon aria-hidden="true" className="size-5 text-sprout-500" />
                <span className="flex-1">{t(label)}</span>
                <ChevronRight aria-hidden="true" className="size-5 text-ink-muted" />
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-2 px-1 text-sm text-ink-muted">{t("settings.privacyNote")}</p>
      </Section>

      <Section title={t("settings.securitySection")}>
        <section aria-label={t("settings.accounts")} className={`${card} p-5`}>
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            <Link2 aria-hidden="true" className="size-4 text-sprout-500" />
            {t("settings.accounts")}
          </p>
          <ul className="mt-3 flex flex-col gap-3">
            {PROVIDERS.map((provider) => {
              const name = PROVIDER_NAME[provider];
              const isLinked = linked.has(provider);
              return (
                <li key={provider} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-bold">
                    <span
                      aria-hidden="true"
                      className={`size-2.5 rounded-full ${
                        isLinked
                          ? provider === "line"
                            ? "bg-line"
                            : "bg-sprout-500"
                          : "bg-sprout-200"
                      }`}
                    />
                    {t(isLinked ? "settings.linked" : "settings.notLinked", { provider: name })}
                  </span>
                  {isLinked
                    ? linked.size > 1 && (
                        <button
                          type="button"
                          disabled={busy}
                          aria-label={t("settings.unlink", { provider: name })}
                          onClick={() => {
                            void run(
                              () =>
                                api.auth.identities[":provider"].$delete({ param: { provider } }),
                              acceptMe,
                            );
                          }}
                          className="press-pill rounded-full border border-sprout-200 px-4 py-2 text-sm font-bold hover:border-sprout-500"
                        >
                          {t("settings.unlinkShort")}
                        </button>
                      )
                    : linkControl(provider)}
                </li>
              );
            })}
          </ul>
        </section>

        <div className="mt-4 flex flex-col gap-3">
          <button
            type="button"
            onClick={() => void leave()}
            className={`${card} press-card flex items-center gap-3 px-5 py-4 font-bold hover:border-sprout-500`}
          >
            <LogOut aria-hidden="true" className="size-5" />
            {t("settings.signOut")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void run(() => api.auth["logout-all"].$post(), leave);
            }}
            className={`${card} press-card flex items-center gap-3 px-5 py-4 font-bold hover:border-sprout-500`}
          >
            <LogOut aria-hidden="true" className="size-5" />
            {t("settings.signOutAll")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setConfirmingDelete(true);
            }}
            className={`${card} press-card flex items-center gap-3 px-5 py-4 font-bold text-red-700 hover:border-red-300`}
          >
            <Trash2 aria-hidden="true" className="size-5" />
            {t("settings.deleteAccount")}
          </button>
        </div>
      </Section>

      {confirmingDelete && (
        <div className="dialog-overlay glass-overlay fixed inset-0 z-50 flex items-end justify-center p-4 md:items-center">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-title"
            aria-describedby="delete-body"
            className="dialog-content glass-dialog w-full max-w-sm rounded-3xl border border-sprout-200/80 p-6"
          >
            <h2 id="delete-title" className="text-lg font-bold">
              {t("settings.deleteTitle")}
            </h2>
            <p id="delete-body" className="mt-2 text-sm text-ink-muted">
              {t("settings.deleteBody")}
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                autoFocus
                onClick={() => {
                  setConfirmingDelete(false);
                }}
                className="press-pill flex-1 rounded-full border border-sprout-200 py-3 font-bold hover:border-sprout-500"
              >
                {t("settings.cancel")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setConfirmingDelete(false);
                  void run(() => api.me.$delete(), leave);
                }}
                className="press-pill flex-1 rounded-full bg-red-700 py-3 font-bold text-white hover:bg-red-700/90"
              >
                {t("settings.deleteConfirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
