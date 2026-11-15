import type { Language } from "@split/shared";
import { Languages } from "lucide-react";
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
      <Link to="/" className="flex items-center gap-2.5 text-lg font-bold text-ink">
        <SproutMascot className="size-8" mood="happy" interactive={false} />
        <span>{t("app.name")}</span>
      </Link>
      <nav aria-label={t("app.name")} className="flex items-center gap-2 sm:gap-3">
        <Link
          to="/flights"
          className={`press-pill rounded-full px-3.5 py-2 text-sm font-bold transition-colors ${
            active === "flights" ? "bg-sprout-900 text-white" : "text-sprout-900 hover:bg-white/70"
          }`}
        >
          {t("landing.headerFlights")}
        </Link>
        <button
          type="button"
          onClick={toggleLocale}
          aria-label={t("landing.langAria")}
          className="press-pill inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-sprout-900/15 bg-white/75 px-3 py-2 text-xs font-bold text-sprout-900 hover:bg-white"
        >
          <Languages aria-hidden="true" className="size-3.5" />
          <span>{t("landing.langSwitch")}</span>
        </button>
        <Link
          to="/sign-in"
          className="press-pill rounded-full border border-sprout-900/20 bg-white/80 px-4 py-2 text-sm font-bold text-sprout-900 hover:bg-white"
        >
          {t("landing.headerSignIn")}
        </Link>
      </nav>
    </header>
  );
}
