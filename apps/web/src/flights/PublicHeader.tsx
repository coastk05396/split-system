import type { Language } from "@split/shared";
import type { ReactNode } from "react";
import { Globe } from "lucide-react";
import { Link } from "react-router";
import { rememberLocale } from "../i18n/detect.js";
import { getLocale, setLocale, t } from "../i18n/messages.js";
import { SproutMascot } from "../shell/SproutMascot.js";

/**
 * Shared top navigation for public / signed-out views (`/`, `/landing`, `/flights`). Two tiers:
 * a utility bar (mascot left; language toggle and 登入 right), then the optional `title` block.
 */
export function PublicHeader({ title }: { title?: ReactNode }) {
  const locale = getLocale();
  const nextLocale: Language = locale === "zh-TW" ? "en" : "zh-TW";

  function toggleLocale() {
    rememberLocale(nextLocale);
    setLocale(nextLocale);
  }

  return (
    <header className="mx-auto w-full max-w-6xl px-5 md:px-10">
      <div className="flex h-14 items-center justify-between gap-2">
        <Link
          to="/"
          aria-label={t("app.name")}
          className="flex shrink-0 items-center gap-2.5 text-lg font-bold text-slate-900"
        >
          <SproutMascot className="size-8" mood="happy" interactive={false} />
          {!title && <span>{t("app.name")}</span>}
        </Link>
        <nav aria-label={t("app.name")} className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={toggleLocale}
            aria-label={t("landing.langAria")}
            className="press-pill inline-flex min-h-11 min-w-11 cursor-pointer items-center gap-1.5 px-2 text-[13px] font-semibold tracking-[0.02em] text-[#5a645e] focus-visible:outline-2 focus-visible:outline-fl-green"
          >
            <Globe aria-hidden="true" className="size-4" />
            <span>{t("landing.langSwitch")}</span>
          </button>
          <Link
            to="/sign-in"
            className="press-pill inline-flex h-11 items-center rounded-[10px] bg-fl-ink px-[18px] text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fl-green"
          >
            {t("landing.headerSignIn")}
          </Link>
        </nav>
      </div>
      {title}
    </header>
  );
}
