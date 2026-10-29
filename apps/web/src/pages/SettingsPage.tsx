import { PROVIDERS, type Me, type Provider } from "@split/shared";
import { ChevronRight, FileText, Link2, LogOut, ShieldCheck, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import { createApiClient, withJson } from "../api/client.js";
import { type ErrorCode, toApiFailure } from "../api/errors.js";
import { useDeps } from "../app/AppProviders.js";
import { useAuth } from "../auth/AuthProvider.js";
import { GoogleButton } from "../auth/GoogleButton.js";
import { errorMessage, t } from "../i18n/messages.js";

const PROVIDER_NAME: Record<Provider, string> = { line: "LINE", google: "Google" };

const card = "rounded-3xl border border-sprout-200 bg-white";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="mt-8">
      <h2 className="mb-3 text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}

function Avatar({ user }: { user: Me }) {
  const [broken, setBroken] = useState(false);
  if (user.pictureUrl !== null && !broken) {
    return (
      <img
        src={user.pictureUrl}
        alt=""
        onError={() => {
          setBroken(true);
        }}
        className="size-16 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex size-16 items-center justify-center rounded-full bg-peach text-2xl font-bold text-sprout-600"
    >
      {user.displayName.slice(0, 1)}
    </span>
  );
}

/**
 * Screen 11 (設定與帳號) as changed by docs/design-changes.md: no 通知提醒 or 預設幣別;
 * linked Identities with link and unlink, 登出所有裝置, 刪除帳號, and the policy links.
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
        className="rounded-full bg-line px-4 py-2 text-sm font-bold text-white"
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

      <div className={`${card} mt-6 flex items-center gap-4 p-5`}>
        <Avatar user={user} />
        <div>
          <p className="text-xl font-bold">{user.displayName}</p>
          <p className="text-sm text-ink-muted">
            {t("settings.linkedVia", {
              providers: user.identities.map((i) => PROVIDER_NAME[i.provider]).join("、"),
            })}
          </p>
        </div>
      </div>

      {error !== null && (
        <p role="alert" className="mt-6 rounded-2xl bg-peach px-4 py-3 text-sm">
          {errorMessage(error)}
        </p>
      )}

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
                  <span className="font-bold">
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
                          className="rounded-full border border-sprout-200 px-4 py-2 text-sm font-bold"
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
            className={`${card} flex items-center gap-3 px-5 py-4 font-bold`}
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
            className={`${card} flex items-center gap-3 px-5 py-4 font-bold`}
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
            className={`${card} flex items-center gap-3 px-5 py-4 font-bold text-red-700`}
          >
            <Trash2 aria-hidden="true" className="size-5" />
            {t("settings.deleteAccount")}
          </button>
        </div>
      </Section>

      {confirmingDelete && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 md:items-center">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-title"
            aria-describedby="delete-body"
            className="w-full max-w-sm rounded-3xl bg-white p-6"
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
                className="flex-1 rounded-full border border-sprout-200 py-3 font-bold"
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
                className="flex-1 rounded-full bg-red-700 py-3 font-bold text-white"
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
