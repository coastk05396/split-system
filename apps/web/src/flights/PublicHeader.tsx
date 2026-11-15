import type { Language } from "@split/shared";
import { Languages, PlaneTakeoff } from "lucide-react";
import { Link } from "react-router";
import { rememberLocale } from "../i18n/detect.js";
import { getLocale, setLocale, t } from "../i18n/messages.js";
import { SproutMascot } from "../shell/SproutMascot.js";

/** Shared top navigation bar for public / signed-out views (`/`, `/landing`, `/flights`). */
export function PublicHeader({ active }: { active?: "home" | "flights" }) {
  const locale = getLocale();
  const nextLocale: Language = locale === "zh-TW" ? "en" : "zh-TW";

  function toggleLocale() {
    rememberLocale(nextLocale);
    setLocale(nextLocale);
  }

  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-5 py-5 md:px-10">
      <Link to="/" className="flex items-center gap-2.5 text-lg font-bold text-slate-900">
        <SproutMascot className="size-8" mood="happy" interactive={false} />
        <span>{t("app.name")}</span>
      </Link>
      <nav aria-label={t("app.name")} className="flex items-center gap-2 sm:gap-3">
        {active !== "home" && (
          <Link
            to="/flights"
            className={`press-pill inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-bold transition-colors ${
              active === "flights"
                ? "border-sprout-500 bg-sprout-500 text-white shadow-sm"
                : "border-sprout-200 bg-sprout-50/90 text-sprout-800 shadow-xs hover:border-sprout-400 hover:bg-sprout-100/80"
            }`}
          >
            <PlaneTakeoff className="size-3.5" aria-hidden="true" />
            <span>{t("landing.headerFlights")}</span>
          </Link>
        )}
        <button
          type="button"
          onClick={toggleLocale}
          aria-label={t("landing.langAria")}
          className="press-pill inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 bg-white/90 px-3 py-2 text-xs font-bold text-slate-700 shadow-xs transition-colors hover:border-slate-300 hover:bg-white"
        >
          <Languages aria-hidden="true" className="size-3.5" />
          <span>{t("landing.langSwitch")}</span>
        </button>
        <Link
          to="/sign-in"
          className="press-pill rounded-full border border-slate-200 bg-white/90 px-4 py-2 text-sm font-bold text-slate-800 shadow-xs transition-colors hover:border-slate-300 hover:bg-white"
        >
          {t("landing.headerSignIn")}
        </Link>
      </nav>
    </header>
  );
}
