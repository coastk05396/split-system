import { ArrowRight, HandCoins, type LucideIcon, Plane, ReceiptText } from "lucide-react";
import { Link } from "react-router";
import { type MessageId, t } from "../i18n/messages.js";
import { SproutMascot } from "../shell/SproutMascot.js";

const FEATURES: readonly { icon: LucideIcon; title: MessageId; body: MessageId }[] = [
  { icon: ReceiptText, title: "landing.feature1.title", body: "landing.feature1.body" },
  { icon: Plane, title: "landing.feature2.title", body: "landing.feature2.body" },
  { icon: HandCoins, title: "landing.feature3.title", body: "landing.feature3.body" },
];

/** Screen 21: the static page signed-out visitors see at `/` (SPEC §6). */
export function LandingPage() {
  const [titleFirst, titleSecond] = t("landing.title").split("，");
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 md:px-10">
        <span className="flex items-center gap-2.5 text-lg font-bold">
          <SproutMascot className="size-8" mood="happy" interactive={false} />
          {t("app.name")}
        </span>
        <Link
          to="/sign-in"
          className="press-pill rounded-full bg-sprout-500 px-5 py-2 text-sm font-bold text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25)] hover:bg-sprout-600"
        >
          {t("landing.headerSignIn")}
        </Link>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-5 pt-10 pb-16 md:px-10 md:pt-20">
          <p className="text-sm font-bold tracking-wide text-sprout-500">{t("landing.eyebrow")}</p>
          <h1 className="mt-4 text-4xl leading-tight font-black md:text-6xl">
            {titleFirst}，
            <br />
            {titleSecond}
          </h1>
          <p className="mt-5 max-w-xl text-ink-muted md:text-lg">{t("landing.body")}</p>
          <Link
            to="/sign-in"
            className="press-pill mt-8 inline-flex items-center gap-3 rounded-full bg-sprout-500 px-7 py-3.5 font-bold text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_18px_-10px_#143f2a] hover:bg-sprout-600"
          >
            {t("landing.signIn")}
            <ArrowRight aria-hidden="true" className="size-5" />
          </Link>
          <p className="mt-3 text-xs text-ink-muted">{t("landing.providers")}</p>
        </section>

        <section className="bg-white">
          <ul className="mx-auto grid max-w-6xl gap-4 px-5 py-14 md:grid-cols-3 md:px-10">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <li key={title} className="rounded-3xl border border-sprout-200 bg-sprout-50 p-6">
                <span className="flex size-12 items-center justify-center rounded-2xl bg-sprout-100 text-sprout-500">
                  <Icon aria-hidden="true" className="size-6" />
                </span>
                <h2 className="mt-4 text-lg font-bold">{t(title)}</h2>
                <p className="mt-1 text-sm text-ink-muted">{t(body)}</p>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="bg-sprout-900 text-white/80">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-xs md:flex-row md:items-center md:justify-between md:px-10">
          <span>{t("landing.footer")}</span>
          <span className="flex gap-4">
            <Link to="/terms" className="hover:text-white">
              {t("signIn.terms")}
            </Link>
            <Link to="/privacy" className="hover:text-white">
              {t("signIn.privacy")}
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
