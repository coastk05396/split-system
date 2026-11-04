import { CURRENCY_CODES, LANGUAGES, type Me, type Provider } from "@split/shared";
import { Check, ChevronRight, LoaderCircle } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { createApiClient, withJson } from "../api/client.js";
import { type ErrorCode, toApiFailure } from "../api/errors.js";
import { useDeps } from "../app/AppProviders.js";
import { useAuth } from "../auth/AuthProvider.js";
import { GoogleButton, GoogleG } from "../auth/GoogleButton.js";
import { Avatar } from "../groups/ui.js";
import { errorMessage, t } from "../i18n/messages.js";

/** Gmail's envelope, shown when a Google account has no picture. */
function GmailMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-7">
      <path
        fill="#EA4335"
        d="M2 6.5v11A1.5 1.5 0 0 0 3.5 19H6V9.9l6 4.5 6-4.5V19h2.5a1.5 1.5 0 0 0 1.5-1.5v-11c0-1.2-1.37-1.9-2.33-1.17L12 10.5 4.33 5.33C3.37 4.6 2 5.3 2 6.5z"
      />
    </svg>
  );
}

const PROVIDER_NAME: Record<Provider, string> = { line: "LINE", google: "Google" };

const card = "surface-card rounded-3xl border border-sprout-200 bg-white";

const rowBase =
  "press-card group flex w-full items-center gap-3 px-4 py-4 text-left font-bold hover:bg-sprout-50";

/** The divider between rows starts after the icon box, as in the approved demo. */
const rowDivider =
  "relative not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-[3.25rem] not-first:before:h-px not-first:before:bg-sprout-150";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="mt-7">
      <h2 className="mb-2 px-2 text-[13px] font-extrabold tracking-wider text-sprout-600">
        {title}
      </h2>
      {children}
    </section>
  );
}

function IconBox({ children, danger = false }: { children: ReactNode; danger?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex size-8 shrink-0 items-center justify-center rounded-[10px] text-base ${
        danger ? "bg-red-50" : "bg-sprout-150"
      }`}
    >
      {children}
    </span>
  );
}

function Chevron() {
  return (
    <ChevronRight
      aria-hidden="true"
      className="size-5 text-sprout-500 transition-transform duration-300 ease-(--ease-spring) group-hover:translate-x-1 motion-reduce:transition-none"
    />
  );
}

/** A settings row that shows its current value and opens the native picker when tapped. */
function PickerRow(props: { icon: ReactNode; label: string; value: string; children: ReactNode }) {
  return (
    <div
      className={`${rowBase} relative focus-within:ring-2 focus-within:ring-sprout-500/40 focus-within:ring-inset`}
    >
      <IconBox>{props.icon}</IconBox>
      {props.label}
      <span className="ml-auto font-semibold text-sprout-600">{props.value}</span>
      <Chevron />
      {props.children}
    </div>
  );
}

const pickerSelect = "absolute inset-0 size-full cursor-pointer opacity-0";

/**
 * Screen 11 (設定與帳號) as changed by docs/design-changes.md: no 通知提醒; the 偏好幣別
 * (Preferred currency) and 語言 sit under the profile, then 登入與安全 (linked Identities with
 * unlink), the policy links, 登出 and 刪除帳號. No hint text, no 登出所有裝置.
 */
export function SettingsPage() {
  const { state, session, signOut, updateUser } = useAuth();
  const { line, google } = useDeps();
  const [error, setError] = useState<ErrorCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const current = useRef<Me | null>(null);
  // What was already linked when the page opened is shown still; only a new link pops in.
  const startedLinked = useRef(
    new Set(state.status === "signedIn" ? state.user.identities.map((i) => i.provider) : []),
  );
  current.current = state.status === "signedIn" ? state.user : null;
  const isSignedIn = state.status === "signedIn";

  // A Google link finished in the outside browser shows up here when the person switches back.
  useEffect(() => {
    if (!isSignedIn) return;
    let active = true;
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      // An answer is stale if the linked accounts changed (unlink) or the page closed meanwhile.
      const before = current.current?.identities;
      try {
        const res: Response = await createApiClient(session.fetch).me.$get();
        if (!res.ok) return;
        const identities = ((await res.json()) as Me).identities;
        const user = current.current;
        if (!active || user === null || user.identities !== before) return;
        // Only the linked accounts: this screen's profile card stays that of this sign-in.
        updateUser({ ...user, identities });
      } catch {
        // Offline or signed out meanwhile: the next switch back tries again.
      }
    };
    const onVisible = () => {
      void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [isSignedIn, session, updateUser]);

  if (state.status !== "signedIn") return null;
  const user = state.user;
  const api = createApiClient(session.fetch);
  const linked = new Set(user.identities.map((identity) => identity.provider));
  const profileProvider = user.signedInWith;
  const profileEmail = user.identities.find((i) => i.provider === profileProvider)?.email ?? null;
  const profileName =
    profileProvider === "google" && profileEmail !== null ? profileEmail : user.displayName;

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

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-3xl font-black">{t("settings.heading")}</h1>

      <div className={`${card} line-bubble-card group mt-6 flex items-center gap-3 p-3.5`}>
        {profileProvider === "google" && user.pictureUrl === null ? (
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-white ring-2 ring-sprout-200">
            <GmailMark />
          </span>
        ) : (
          <Avatar
            name={user.displayName}
            pictureUrl={user.pictureUrl}
            className="size-12 text-xl ring-2 ring-sprout-200 transition-transform duration-500 ease-(--ease-spring) group-hover:-rotate-6 group-hover:scale-105 motion-reduce:transition-none"
          />
        )}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <p className="min-w-0 break-all text-lg font-bold">{profileName}</p>
          <span
            aria-hidden="true"
            className={
              profileProvider === "line"
                ? "inline-flex items-center gap-1 rounded-full bg-line px-2 py-0.5 text-[11px] font-bold tracking-wide text-sprout-900"
                : "inline-flex items-center gap-1 rounded-full border border-[#747775] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#1F1F1F]"
            }
          >
            {profileProvider === "google" && <GoogleG className="size-3" />}
            {PROVIDER_NAME[profileProvider]}
          </span>
        </div>
      </div>

      <Section title={t("settings.currencySection")}>
        <div className={`${card} overflow-hidden`}>
          <PickerRow
            icon="💰"
            label={t("settings.currencyLabel")}
            value={t(`currency.${user.preferredCurrency}`)}
          >
            <select
              aria-label={t("settings.currencySection")}
              value={user.preferredCurrency}
              disabled={busy}
              onChange={(e) => {
                const code = CURRENCY_CODES.find((c) => c === e.target.value);
                if (code === undefined || code === user.preferredCurrency) return;
                void run(() => api.me.$patch({}, withJson({ preferredCurrency: code })), acceptMe);
              }}
              className={pickerSelect}
            >
              {CURRENCY_CODES.map((code) => (
                <option key={code} value={code}>
                  {t(`currency.${code}`)}
                </option>
              ))}
            </select>
          </PickerRow>
        </div>
      </Section>

      {error !== null && (
        <p role="alert" className="mt-6 rounded-2xl bg-peach px-4 py-3 text-sm">
          {errorMessage(error)}
        </p>
      )}

      <Section title={t("settings.languageSection")}>
        <div className={`${card} overflow-hidden`}>
          <PickerRow
            icon="🌐"
            label={t("settings.languageSection")}
            value={t(`language.${user.language}`)}
          >
            <select
              aria-label={t("settings.languageSection")}
              value={user.language}
              disabled={busy}
              onChange={(e) => {
                const language = LANGUAGES.find((l) => l === e.target.value);
                if (language === undefined || language === user.language) return;
                void run(() => api.me.$patch({}, withJson({ language })), acceptMe);
              }}
              className={pickerSelect}
            >
              {LANGUAGES.map((language) => (
                <option key={language} value={language}>
                  {t(`language.${language}`)}
                </option>
              ))}
            </select>
          </PickerRow>
        </div>
      </Section>

      <Section title={t("settings.securitySection")}>
        <ul aria-label={t("settings.accounts")} className={`${card} overflow-hidden`}>
          {(["line", "google"] as const).map((provider) => {
            const name = PROVIDER_NAME[provider];
            const isLinked = linked.has(provider);
            return (
              <li
                key={provider}
                className={`${rowDivider} flex flex-wrap items-center gap-x-3 px-4 py-3.5`}
              >
                {provider === "line" ? (
                  <span
                    aria-hidden="true"
                    className={`mr-0.5 size-2.5 rounded-full ${
                      isLinked ? "link-ping bg-line" : "bg-sprout-200"
                    }`}
                  />
                ) : (
                  <GoogleG className="size-4" />
                )}
                <span className={isLinked ? "font-bold" : "font-medium text-ink-muted"}>
                  {name}
                </span>
                {isLinked && (
                  <span
                    className={`ml-auto inline-flex items-center gap-1 rounded-full bg-sprout-150 px-2.5 py-1 text-sm font-bold text-sprout-700 ${
                      startedLinked.current.has(provider) ? "" : "linked-pop"
                    }`}
                  >
                    <Check aria-hidden="true" className="size-4" strokeWidth={3} />
                    {t("settings.linked")}
                  </span>
                )}
                {isLinked && linked.size > 1 && (
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={t("settings.unlink", { provider: name })}
                    onClick={() => {
                      void run(
                        () => api.auth.identities[":provider"].$delete({ param: { provider } }),
                        acceptMe,
                      );
                    }}
                    className="press-pill rounded-full border border-sprout-200 px-2 py-0.5 text-xs text-ink-muted hover:border-sprout-500"
                  >
                    {t("settings.unlinkShort")}
                  </button>
                )}
                {!isLinked && provider === "line" && (
                  <span className="ml-auto text-xs text-ink-muted">{t("settings.comingSoon")}</span>
                )}
                {!isLinked && provider === "google" && google.available && (
                  <span className="ml-auto">
                    {line.isInClient() ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          void run(
                            () => api.auth["link-code"].$post(),
                            async (res) => {
                              const { code } = (await res.json()) as { code: string };
                              await line.openExternal(
                                `${window.location.origin}/link?code=${code}`,
                              );
                            },
                          );
                        }}
                        className="press-pill press-deep flex min-h-11 items-center gap-1.5 rounded-full bg-sprout-600 px-5 text-sm font-bold text-white active:bg-sprout-700"
                      >
                        {busy && (
                          <LoaderCircle
                            aria-hidden="true"
                            className="size-4 animate-spin motion-reduce:animate-none"
                          />
                        )}
                        {busy ? t("settings.linkingGoogle") : t("settings.linkGoogle")}
                      </button>
                    ) : (
                      <GoogleButton
                        compact
                        label={t("settings.linkGoogle")}
                        errand={{ purpose: "link" }}
                      />
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title={t("settings.privacySection")}>
        <ul className={`${card} overflow-hidden`}>
          {(
            [
              ["/privacy", "🛡️", "settings.privacy"],
              ["/terms", "📄", "settings.terms"],
            ] as const
          ).map(([to, icon, label]) => (
            <li key={to} className={rowDivider}>
              <Link to={to} className={rowBase}>
                <IconBox>{icon}</IconBox>
                <span className="flex-1">{t(label)}</span>
                <Chevron />
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <div className={`${card} mt-7 overflow-hidden`}>
        <button type="button" onClick={() => void leave()} className={`${rowBase} ${rowDivider}`}>
          <IconBox>👋</IconBox>
          {t("settings.signOut")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setConfirmingDelete(true);
          }}
          className={`${rowBase} ${rowDivider} text-red-700 hover:bg-red-50`}
        >
          <IconBox danger>🗑️</IconBox>
          {t("settings.deleteAccount")}
        </button>
      </div>

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
