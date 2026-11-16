import type { Language } from "@split/shared";
import type { ReactNode } from "react";
import { Languages } from "lucide-react";
import { Link } from "react-router";
import { rememberLocale } from "../i18n/detect.js";
import { getLocale, setLocale, t } from "../i18n/messages.js";
import { SproutMascot } from "../shell/SproutMascot.js";

/**
 * Shared top navigation bar for public / signed-out views (`/`, `/landing`, `/flights`).
 * With `title`, it is a single row: mascot logo only, the title block beside it, actions on the right.
 */
export function PublicHeader({ title }: { title?: ReactNode }) {
  const locale = getLocale();
  const nextLocale: Language = locale === "zh-TW" ? "en" : "zh-TW";

  function toggleLocale() {
    rememberLocale(nextLocale);
    setLocale(nextLocale);
  }

  return (
    <header
      className={`mx-auto flex w-full max-w-6xl items-center justify-between gap-2 md:px-10 ${title ? "px-4 pt-4 pb-3" : "gap-3 px-5 py-5"}`}
    >
      <Link
        to="/"
        aria-label={t("app.name")}
        className="flex shrink-0 items-center gap-2.5 text-lg font-bold text-slate-900"
      >
        <SproutMascot className={title ? "size-11" : "size-8"} mood="happy" interactive={false} />
        {!title && <span>{t("app.name")}</span>}
      </Link>
      {title}
      <nav aria-label={t("app.name")} className="flex shrink-0 items-center gap-1.5 sm:gap-3">
        <button
          type="button"
          onClick={toggleLocale}
          aria-label={t("landing.langAria")}
          className="press-pill inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-full border border-slate-200 bg-white/90 px-2.5 py-2 text-xs font-bold text-slate-700 shadow-xs transition-colors hover:border-slate-300 hover:bg-white"
        >
          <Languages aria-hidden="true" className="hidden size-3.5 sm:block" />
          <span>{t("landing.langSwitch")}</span>
        </button>
        <Link
          to="/sign-in"
          className="press-pill rounded-full border border-slate-200 bg-white/90 px-3 py-2 text-sm sm:px-4 font-bold text-slate-800 shadow-xs transition-colors hover:border-slate-300 hover:bg-white"
        >
          {t("landing.headerSignIn")}
        </Link>
      </nav>
    </header>
  );
}
