import { filterDailyFlights, type FlightRegion, sortDailyFlights } from "@split/shared";
import { ArrowRight, PlaneTakeoff, Sparkles } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { CategoryIcon } from "../expenses/CategoryIcon.js";
import { useDailyFlights } from "../flights/api.js";
import {
  FlightAirlineSummary,
  FlightBadges,
  FlightBookAnchor,
  flightDestinationLabel,
  PublicHeader,
} from "../flights/ui.js";
import { getLocale, type MessageId, t } from "../i18n/messages.js";
import { SproutMascot } from "../shell/SproutMascot.js";

const FEATURES: readonly { title: MessageId; body: MessageId }[] = [
  { title: "landing.feature1.title", body: "landing.feature1.body" },
  { title: "landing.feature2.title", body: "landing.feature2.body" },
  { title: "landing.feature3.title", body: "landing.feature3.body" },
];

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
    tripType: "all",
    month: "all",
    directOnly: false,
    holidayOnly: false,
  });
  const boardItems = sortDailyFlights(filtered, "discount").slice(0, 4);

  return (
    <div className="landing-editorial flex min-h-dvh flex-col">
      <PublicHeader active="home" />
      <main className="flex-1">
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-5 pt-6 pb-16 lg:grid-cols-[1.05fr_1fr] lg:gap-12 md:px-10 md:pt-14 md:pb-24">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-sprout-200 bg-white/80 px-3.5 py-1 text-xs font-bold tracking-wider text-sprout-700">
              <Sparkles aria-hidden="true" className="size-3.5" />
              <span>{t("landing.eyebrow")}</span>
            </p>
            <h1 className="mt-5 font-serif text-4xl leading-[1.3] tracking-wide text-ink md:text-5xl lg:text-6xl">
              {t("landing.title")}
            </h1>
            <p className="mt-5 max-w-md text-sm leading-7 text-ink-muted md:text-base md:leading-8">
              {t("landing.body")}
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                to="/flights"
                className="press-pill inline-flex items-center gap-3 rounded-full bg-sprout-900 px-6 py-3.5 text-sm font-bold text-white shadow-sm hover:bg-sprout-700"
              >
                <PlaneTakeoff aria-hidden="true" className="size-4" />
                <span>{t("landing.exploreFlights")}</span>
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
              <Link
                to="/sign-in"
                className="press-pill inline-flex items-center gap-2 rounded-full border border-sprout-900/20 bg-white/85 px-6 py-3.5 text-sm font-bold text-sprout-900 hover:bg-white"
              >
                <span>{t("landing.signIn")}</span>
              </Link>
            </div>
            <p className="mt-4 max-w-xs text-xs leading-6 text-ink-muted">
              {t("landing.providers")}
            </p>
          </div>

          <div className="relative flex flex-col gap-4">
            <section
              aria-label={t("landing.liveBoard.title")}
              className="clay-receipt rounded-[1.75rem] border border-sprout-200/80 bg-white/95 p-5 shadow-md"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-2.5 animate-pulse rounded-full bg-sprout-500"
                  />
                  <h2 className="text-base font-bold text-ink">{t("landing.liveBoard.title")}</h2>
                </div>
                <span className="rounded-full bg-sprout-100 px-2.5 py-0.5 text-[11px] font-bold text-sprout-700">
                  {t("landing.liveBoard.badge")}
                </span>
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
                        ? "border-sprout-700 bg-sprout-700 text-white"
                        : "border-sprout-200 bg-sprout-50/70 text-ink hover:bg-sprout-100"
                    }`}
                  >
                    {t(pill.label)}
                  </button>
                ))}
              </div>

              <ul className="mt-4 flex flex-col gap-2.5" aria-live="polite">
                {boardItems.map((item) => {
                  const dest = flightDestinationLabel(item, locale);
                  return (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-sprout-200/70 bg-white px-3.5 py-2.5 shadow-2xs transition-colors hover:border-sprout-400"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span aria-hidden="true" className="text-base">
                            {dest.flag}
                          </span>
                          <span className="font-bold text-ink">{dest.city}</span>
                          <span className="text-xs font-semibold text-ink-muted tabular-nums">
                            {item.origin} → {item.dest}
                          </span>
                        </div>
                        <div className="mt-1">
                          <FlightBadges item={item} lang={locale} />
                        </div>
                        <p className="mt-1 truncate text-[11px] text-ink-muted">
                          <FlightAirlineSummary item={item} lang={locale} />
                        </p>
                      </div>
                      <FlightBookAnchor
                        item={item}
                        lang={locale}
                        className="press-pill flex shrink-0 flex-col items-end rounded-xl bg-sprout-50 px-3 py-2 text-right transition-colors hover:bg-sprout-100"
                      >
                        <span className="text-base font-bold text-sprout-900 tabular-nums">
                          NT$ {item.priceTwd.toLocaleString("en-US")}
                        </span>
                        <span className="text-[11px] font-bold text-sprout-700">
                          {t("flights.bookCta")} →
                        </span>
                      </FlightBookAnchor>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-4 flex items-center justify-between border-t border-dashed border-sprout-900/15 pt-3">
                <span className="text-[11px] text-ink-muted">{t("flights.disclaimer")}</span>
                <Link
                  to="/flights"
                  className="shrink-0 text-xs font-bold text-sprout-700 hover:text-sprout-900"
                >
                  {t("landing.liveBoard.viewMore")} →
                </Link>
              </div>
            </section>

            <div className="flex items-center justify-between gap-4 rounded-3xl border border-sprout-200/80 bg-white/85 px-5 py-4 shadow-sm">
              <div className="flex items-center gap-3.5">
                <CategoryIcon category="餐飲" className="size-11 shrink-0" />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-peach px-2 py-0.5 text-[11px] font-bold text-terracotta-ink">
                      {t("landing.splitCard.badge")}
                    </span>
                    <span className="text-sm font-bold text-ink">
                      {t("landing.splitCard.title")}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {t("landing.splitCard.sampleItem")} · {t("landing.splitCard.sampleSplit")} · NT$
                    620
                  </p>
                  <p className="mt-0.5 text-[11px] font-semibold text-sprout-700">
                    {t("landing.splitCard.sampleResult")}
                  </p>
                </div>
              </div>
              <SproutMascot className="size-16 shrink-0" mood="wave" />
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl border-t border-sprout-900/10 px-5 py-8 md:px-10 md:py-12">
          <ul className="divide-y divide-sprout-900/10">
            {FEATURES.map(({ title, body }, index) => (
              <li
                key={title}
                className="grid grid-cols-[2rem_1fr] items-baseline gap-x-4 gap-y-2 py-6 md:grid-cols-[3rem_12rem_1fr] md:gap-x-8"
              >
                <span
                  aria-hidden="true"
                  className="font-serif text-sm text-sprout-700 tabular-nums"
                >
                  0{index + 1}
                </span>
                <h2 className="font-serif text-xl">{t(title)}</h2>
                <p className="col-start-2 text-sm leading-7 text-ink-muted md:col-start-3">
                  {t(body)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <footer className="border-t border-sprout-900/10">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-8 text-xs text-ink-muted md:flex-row md:items-center md:justify-between md:px-10">
          <span>{t("landing.footer")}</span>
          <span className="flex gap-4">
            <Link to="/terms" className="hover:text-sprout-900">
              {t("signIn.terms")}
            </Link>
            <Link to="/privacy" className="hover:text-sprout-900">
              {t("signIn.privacy")}
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
