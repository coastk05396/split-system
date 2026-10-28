import { useAuth } from "../auth/AuthProvider.js";
import { t } from "../i18n/messages.js";
import { SproutMark } from "../shell/SproutMark.js";

/** Screen 2 header; the Balance card and quick-start cards arrive with the Groups screens. */
export function HomePage() {
  const { state } = useAuth();
  const name = state.status === "signedIn" ? state.user.displayName : "";
  return (
    <header className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold md:text-4xl">{t("home.greeting", { name })}</h1>
        <p className="mt-1 text-sm text-ink-muted md:text-base">{t("home.subtitle")}</p>
      </div>
      <SproutMark className="size-14" />
    </header>
  );
}
