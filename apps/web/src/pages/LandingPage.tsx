import { filterDailyFlights, type FlightRegion } from "@split/shared";
import { ArrowRight, PlaneTakeoff, ReceiptText } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { CategoryIcon } from "../expenses/CategoryIcon.js";
import { useDailyFlights } from "../flights/api.js";
import { CityFlightCard } from "../flights/CityFlightCard.js";
import { FlightsIconTile, FlightsTitle } from "../flights/FlightsTitle.js";
import { groupByCity } from "../flights/groups.js";
import { flightsUpdatedNote, PublicHeader } from "../flights/ui.js";
import { getLocale, type MessageId, t } from "../i18n/messages.js";
import { SproutMascot } from "../shell/SproutMascot.js";

type PreviewRegion = "all" | Extract<FlightRegion, "jp" | "kr" | "sea" | "hkmo">;

const PREVIEW_REGIONS: readonly { value: PreviewRegion; label: MessageId }[] = [
  { value: "all", label: "flights.region.all" },
  { value: "jp", label: "flights.region.jp" },
  { value: "kr", label: "flights.region.kr" },
  { value: "sea", label: "flights.region.sea" },
  { value: "hkmo", label: "flights.region.hkmo" },
];

/** Screen 21: dual-core landing page showcasing live floating cheap flights and quick splits (SPEC §6). */
export function LandingPage() {
  const locale = getLocale();
  const flights = useDailyFlights();
  const [region, setRegion] = useState<PreviewRegion>("all");

  const items = flights.data.items;
  const filtered = filterDailyFlights(items, {
    region,
    origin: "all",
    month: "all",
    directOnly: false,
    holidayOnly: false,
  });
  // Same city cards and badge rule as /flights, cheapest cities first; only four fit here
  const boardGroups = groupByCity(filtered).slice(0, 4);

  return (
    <div className="landing-editorial flex min-h-dvh flex-col">
      <PublicHeader />
      <main className="min-w-0 flex-1">
        <section className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-5 pt-6 pb-16 lg:grid-cols-[0.95fr_1.05fr] lg:gap-12 md:px-10 md:pt-12 md:pb-20">
          <div className="min-w-0">
            <h1 className="text-[27px] leading-[1.25] font-black text-balance tracking-tight text-slate-900 sm:text-4xl md:text-5xl lg:text-[3.5rem]">
              {t("landing.title")}
            </h1>
            <div className="mt-6 inline-flex flex-wrap items-center gap-2.5 rounded-2xl border border-slate-200/80 bg-white/85 px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-2xs">
              <span className="inline-flex items-center gap-1.5">
                <PlaneTakeoff aria-hidden="true" className="size-4 text-sprout-600" />
                <span>{t("landing.step1")}</span>
              </span>
              <ArrowRight aria-hidden="true" className="size-3.5 text-slate-300" />
              <span className="inline-flex items-center gap-1.5">
                <ReceiptText aria-hidden="true" className="size-4 text-amber-600" />
                <span>{t("landing.step2")}</span>
              </span>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/flights"
                className="press-pill inline-flex items-center gap-3 rounded-full bg-sprout-500 px-7 py-3.5 text-sm font-bold text-white shadow-md shadow-sprout-500/20 transition-colors hover:bg-sprout-600"
              >
                <PlaneTakeoff aria-hidden="true" className="size-4" />
                <span>{t("landing.exploreFlights")}</span>
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </div>
          </div>

          <div className="relative flex min-w-0 flex-col gap-4">
            <section
              aria-label={t("landing.liveBoard.title")}
              className="font-flights -mx-3 min-w-0 rounded-[1.75rem] border border-sprout-200/75 bg-white/95 p-3 sm:mx-0 sm:p-5 shadow-lg shadow-slate-900/[0.04] backdrop-blur-sm"
            >
              <div className="flex items-center gap-2.5">
                <FlightsIconTile />
                <FlightsTitle as="h2" size="md" note />
              </div>

              <div
                role="group"
                aria-label={t("flights.regionLabel")}
                className="mt-3 flex flex-wrap gap-1.5"
              >
                {PREVIEW_REGIONS.map((pill) => (
                  <button
                    key={pill.value}
                    type="button"
                    aria-pressed={region === pill.value}
                    onClick={() => {
                      setRegion(pill.value);
                    }}
                    className={`press-pill cursor-pointer rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
                      region === pill.value
                        ? "border-sprout-500 bg-sprout-500 text-white"
                        : "border-slate-200 bg-slate-50 text-fl-sub hover:border-sprout-500/40 hover:bg-sprout-50"
                    }`}
                  >
                    {t(pill.label)}
                  </button>
                ))}
              </div>

              {flights.data.isFallback && (
                <p className="mt-2.5 rounded-xl bg-amber-50 px-3 py-1.5 text-[11px] font-medium text-amber-900">
                  {t("flights.fallbackNote")}
                </p>
              )}

              <ul className="mt-3.5 flex min-w-0 flex-col gap-2" aria-live="polite">
                {boardGroups.map((group) => (
                  <li key={group.cityKey} className="min-w-0">
                    <CityFlightCard group={group} lang={locale} />
                  </li>
                ))}
              </ul>

              <div className="mt-4 flex items-center justify-between gap-2 border-t border-dashed border-slate-200 pt-3">
                <span className="text-[11px] text-fl-muted">
                  {flightsUpdatedNote(flights.data.date, flights.data.isFallback)}
                </span>
                <Link
                  to="/flights"
                  className="shrink-0 text-xs font-bold text-sprout-600 hover:text-sprout-800"
                >
                  {t("landing.liveBoard.viewMore")} →
                </Link>
              </div>
            </section>

            <div className="clay-receipt flex items-center justify-between gap-4 rounded-3xl px-5 py-4">
              <div className="flex items-center gap-3.5">
                <CategoryIcon category="餐飲" className="size-11 shrink-0" />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-peach px-2 py-0.5 text-[11px] font-bold text-terracotta-ink">
                      {t("landing.splitCard.badge")}
                    </span>
                    <span className="text-sm font-bold text-slate-900">
                      {t("landing.splitCard.title")}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-600">
                    {t("landing.splitCard.sampleItem")} · {t("landing.splitCard.sampleSplit")} · NT$
                    620
                    {" → "}
                    {t("landing.splitCard.sampleResult")}
                  </p>
                </div>
              </div>
              <SproutMascot className="size-16 shrink-0" mood="wave" />
            </div>
          </div>
        </section>
      </main>
      <footer className="border-t border-slate-200/70 bg-white/60">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-7 text-xs text-slate-500 md:flex-row md:items-center md:justify-between md:px-10">
          <span className="flex gap-4">
            <Link to="/terms" className="hover:text-slate-900">
              {t("signIn.terms")}
            </Link>
            <Link to="/privacy" className="hover:text-slate-900">
              {t("signIn.privacy")}
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
