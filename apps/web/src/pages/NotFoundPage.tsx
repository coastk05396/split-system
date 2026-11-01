import { Link } from "react-router";
import { t } from "../i18n/messages.js";
import { SproutMascot } from "../shell/SproutMascot.js";

export function NotFoundPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <SproutMascot className="size-24" mood="happy" />
      <h1 className="text-xl font-bold">{t("notFound.title")}</h1>
      <Link to="/" className="font-bold text-sprout-500">
        {t("notFound.home")}
      </Link>
    </main>
  );
}
