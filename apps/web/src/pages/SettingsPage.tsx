import { CURRENCY_CODES, LANGUAGES, PROVIDERS, type Me, type Provider } from "@split/shared";
import { ChevronRight, Coins, FileText, Globe, LogOut, ShieldCheck, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import { createApiClient, withJson } from "../api/client.js";
import { type ErrorCode, toApiFailure } from "../api/errors.js";
import { useAuth } from "../auth/AuthProvider.js";
import { Avatar } from "../groups/ui.js";
import { errorMessage, t } from "../i18n/messages.js";

const PROVIDER_NAME: Record<Provider, string> = { line: "LINE", google: "Google" };

const card = "surface-card rounded-3xl border border-sprout-200 bg-white";

const rowBase =
  "press-card group flex w-full items-center gap-3 px-4 py-4 text-left font-bold hover:bg-sprout-50";

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
      className={`flex size-8 shrink-0 items-center justify-center rounded-[10px] ${
        danger ? "bg-red-50 text-red-700" : "bg-sprout-150 text-sprout-600"
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
function PickerRow(props: { icon: ReactNode; value: string; children: ReactNode }) {
  return (
    <div
      className={`${rowBase} relative focus-within:ring-2 focus-within:ring-sprout-500/40 focus-within:ring-inset`}
    >
      <IconBox>{props.icon}</IconBox>
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
  const [error, setError] = useState<ErrorCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (state.status !== "signedIn") return null;
  const user = state.user;
  const api = createApiClient(session.fetch);
  const linked = new Set(user.identities.map((identity) => identity.provider));

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

      <div className={`${card} line-bubble-card group mt-6 flex items-center gap-4 p-5`}>
        <Avatar
          name={user.displayName}
          pictureUrl={user.pictureUrl}
          className="size-16 text-2xl ring-2 ring-sprout-200 transition-transform duration-500 ease-(--ease-spring) group-hover:-rotate-6 group-hover:scale-105 motion-reduce:transition-none"
        />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
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
      </div>

      <Section title={t("settings.currencySection")}>
        <div className={`${card} overflow-hidden`}>
          <PickerRow
            icon={<Coins className="size-[18px]" />}
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
            icon={<Globe className="size-[18px]" />}
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
        <ul aria-label={t("settings.accounts")} className={`${card} divide-y divide-sprout-150`}>
          {/* Only accounts already linked are shown: nobody is offered a second sign-in method. */}
          {PROVIDERS.filter((provider) => linked.has(provider)).map((provider) => {
            const name = PROVIDER_NAME[provider];
            return (
              <li key={provider} className="flex flex-wrap items-center gap-x-3 px-4 py-4">
                <span
                  aria-hidden="true"
                  className={`mr-0.5 size-2.5 rounded-full ${
                    provider === "line" ? "link-ping bg-line" : "bg-sprout-500"
                  }`}
                />
                <span className="font-bold">{name}</span>
                <span className="ml-auto font-semibold text-sprout-600">
                  {t("settings.linked")}
                </span>
                {linked.size > 1 && (
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
                    className="press-pill rounded-full border border-sprout-200 px-3 py-1 text-sm font-bold hover:border-sprout-500"
                  >
                    {t("settings.unlinkShort")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title={t("settings.privacySection")}>
        <ul className={`${card} divide-y divide-sprout-150 overflow-hidden`}>
          {(
            [
              ["/privacy", ShieldCheck, "settings.privacy"],
              ["/terms", FileText, "settings.terms"],
            ] as const
          ).map(([to, Icon, label]) => (
            <li key={to}>
              <Link to={to} className={rowBase}>
                <IconBox>
                  <Icon className="size-[18px]" />
                </IconBox>
                <span className="flex-1">{t(label)}</span>
                <Chevron />
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <div className={`${card} mt-7 divide-y divide-sprout-150 overflow-hidden`}>
        <button type="button" onClick={() => void leave()} className={rowBase}>
          <IconBox>
            <LogOut className="size-[18px]" />
          </IconBox>
          {t("settings.signOut")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setConfirmingDelete(true);
          }}
          className={`${rowBase} text-red-700 hover:bg-red-50`}
        >
          <IconBox danger>
            <Trash2 className="size-[18px]" />
          </IconBox>
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
