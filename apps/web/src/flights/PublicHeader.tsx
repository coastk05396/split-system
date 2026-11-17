import type { Language } from "@split/shared";
import { Globe } from "lucide-react";
import { Link } from "react-router";
import { rememberLocale } from "../i18n/detect.js";
import { getLocale, setLocale, t } from "../i18n/messages.js";
import { SproutMascot } from "../shell/SproutMascot.js";
import { FlightsTitle, FlightsUpdateNote } from "./FlightsTitle.js";

/**
 * Shared top navigation for public / signed-out views (`/landing`, `/flights`). By default one
 * row: mascot left, language toggle and 登入 right. With `flightsTitle` (the /flights board) it
 * is two rows: mascot + title + BETA, then the refresh note with the language toggle and 登入.
 */
export function PublicHeader({ flightsTitle = false }: { flightsTitle?: boolean }) {
  const locale = getLocale();
  const nextLocale: Language = locale === "zh-TW" ? "en" : "zh-TW";

  function toggleLocale() {
    rememberLocale(nextLocale);
    setLocale(nextLocale);
  }

  if (flightsTitle) {
    // The ::after boxes stretch the 40px pills to a 44px tap target without changing their look;
    // they are positioned from the padding box, so the bordered EN pill needs 1.5px more per side.
    const tapTarget = "relative after:absolute after:inset-x-0 after:content-['']";
    return (
      <header className="font-flights mx-auto flex w-full max-w-6xl flex-col gap-2.5 px-5 pt-5 pb-3 md:px-10">
        <div className="flex items-center gap-2.5">
          <Link
            to="/"
            aria-label={t("app.name")}
            className="shrink-0 focus-visible:outline-2 focus-visible:outline-fl-green"
          >
            <SproutMascot className="size-10" mood="happy" interactive={false} />
          </Link>
          <FlightsTitle />
        </div>
        <div className="flex items-center justify-between gap-2">
          <FlightsUpdateNote />
          <nav aria-label={t("app.name")} className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={toggleLocale}
              aria-label={t("landing.langAria")}
              className={`press-pill ${tapTarget} after:-inset-y-[3.5px] inline-flex min-h-10 cursor-pointer items-center rounded-full border-[1.5px] border-fl-hair bg-white px-3.5 text-[13px] font-semibold text-fl-ink focus-visible:outline-2 focus-visible:outline-fl-green`}
            >
              {t("landing.langSwitch")}
            </button>
            <Link
              to="/sign-in"
              className={`press-pill ${tapTarget} after:-inset-y-0.5 inline-flex min-h-10 items-center rounded-full bg-fl-green px-[18px] text-[13px] font-bold text-white shadow-[0_6px_12px_-4px_rgb(4_120_87/0.4)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fl-green`}
            >
              {t("landing.headerSignIn")}
            </Link>
          </nav>
        </div>
      </header>
    );
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
          <span>{t("app.name")}</span>
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
    </header>
  );
}
