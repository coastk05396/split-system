import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { type MessageId, t } from "../i18n/messages.js";
import { CategoryIcon } from "../expenses/CategoryIcon.js";
import { SproutMascot } from "../shell/SproutMascot.js";

const FEATURES: readonly { title: MessageId; body: MessageId }[] = [
  { title: "landing.feature1.title", body: "landing.feature1.body" },
  { title: "landing.feature2.title", body: "landing.feature2.body" },
  { title: "landing.feature3.title", body: "landing.feature3.body" },
];
type Gathering = {
  title: string;
  category: string;
  date: string;
  people: string;
  total: string;
  each: string;
  items: readonly (readonly [string, string])[];
};
const GATHERINGS: readonly [Gathering, Gathering] = [
  {
    title: "居酒屋聚餐",
    category: "餐飲",
    date: "FRIDAY · 19:30",
    people: "4",
    total: "2,480",
    each: "620",
    items: [
      ["串燒與小菜", "1,680"],
      ["飲料", "800"],
    ],
  },
  {
    title: "週末出遊",
    category: "交通",
    date: "SATURDAY · 10:00",
    people: "4",
    total: "3,600",
    each: "900",
    items: [
      ["車票", "1,200"],
      ["午餐與野餐", "2,400"],
    ],
  },
];

/** Screen 21: the page signed-out visitors see at `/` (SPEC §6). */
export function LandingPage() {
  const [selected, setSelected] = useState(GATHERINGS[0]);
  const gathering = selected;
  return (
    <div className="landing-editorial flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 md:px-10">
        <span className="flex items-center gap-2.5 text-lg font-bold">
          <SproutMascot className="size-8" mood="happy" interactive={false} />
          {t("app.name")}
        </span>
        <Link
          to="/sign-in"
          className="press-pill rounded-full border border-sprout-900/20 px-5 py-2 text-sm font-bold text-sprout-900 hover:bg-white/60"
        >
          {t("landing.headerSignIn")}
        </Link>
      </header>
      <main className="flex-1">
        <section className="mx-auto grid max-w-6xl items-center gap-8 px-5 pt-10 pb-16 md:grid-cols-2 md:gap-12 md:px-10 md:pt-20 md:pb-24">
          <div>
            <p className="text-xs font-bold tracking-[0.2em] text-sprout-700">
              {t("landing.eyebrow")}
            </p>
            <h1 className="mt-6 font-serif text-4xl leading-[1.35] tracking-wide md:text-5xl lg:text-6xl">
              {t("landing.title")}
            </h1>
            <p className="mt-6 max-w-sm text-sm leading-8 text-ink-muted md:text-base">
              {t("landing.body")}
            </p>
            <Link
              to="/sign-in"
              className="press-pill mt-8 inline-flex items-center gap-6 rounded-full bg-sprout-900 px-7 py-3.5 text-sm font-bold text-white hover:bg-sprout-700"
            >
              {t("landing.signIn")}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
            <p className="mt-4 max-w-xs text-xs leading-6 text-ink-muted">
              {t("landing.providers")}
            </p>
          </div>
          <div className="relative mx-auto w-full max-w-sm pt-6 md:pt-0">
            <div className="mb-5 flex justify-center gap-2" role="group" aria-label="分帳預覽範例">
              {GATHERINGS.map((example) => (
                <button
                  key={example.title}
                  type="button"
                  aria-pressed={selected === example}
                  onClick={() => setSelected(example)}
                  className={`press-pill rounded-full border px-4 py-2 text-xs transition-colors ${selected === example ? "border-sprout-900/20 bg-white text-sprout-900" : "border-transparent text-ink-muted hover:bg-white/50"}`}
                >
                  {example.title}
                </button>
              ))}
            </div>
            <article
              className="clay-receipt relative mx-4 rounded-[1.75rem] px-7 pt-7 pb-8"
              aria-live="polite"
              aria-atomic="true"
            >
              <div className="flex items-start justify-between">
                <CategoryIcon category={gathering.category} className="size-12" />
                <span className="pt-2 text-[10px] tracking-[0.15em] text-ink-muted">
                  {gathering.date}
                </span>
              </div>
              <h2 className="mt-5 font-serif text-2xl tracking-wide">{gathering.title}</h2>
              <p className="mt-2 text-xs text-ink-muted">{gathering.people} 位朋友・TWD</p>
              <dl className="my-6 space-y-4 border-y border-dashed border-sprout-900/15 py-5 text-sm">
                {gathering.items.map(([name, amount]) => (
                  <div key={name} className="flex justify-between gap-4">
                    <dt className="text-ink-muted">{name}</dt>
                    <dd className="tabular-nums">{amount}</dd>
                  </div>
                ))}
                <div className="flex justify-between gap-4 pt-1 font-bold">
                  <dt>合計</dt>
                  <dd className="tabular-nums">{gathering.total}</dd>
                </div>
              </dl>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-sprout-700">每人剛剛好</span>
                <p className="text-3xl font-medium tracking-tight text-sprout-900 tabular-nums">
                  <span className="mr-1 text-sm">$</span>
                  {gathering.each}
                </p>
              </div>
              <p className="mt-5 text-center text-[10px] tracking-widest text-ink-muted">
                分帳範例・美好時光，一起收藏
              </p>
            </article>
            <div className="-mt-5 -mb-6 flex justify-end md:-mr-8">
              <SproutMascot className="size-32 md:size-40" mood="wave" />
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
