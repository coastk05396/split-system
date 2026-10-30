import { useEffect } from "react";
import { useRouteError } from "react-router";
import { t } from "../i18n/messages.js";
import { Splash } from "../shell/Splash.js";
import { isStaleFileError, reloadedRecently, reloadForNewVersion } from "./new-version.js";

/**
 * Where a route's error lands instead of React Router's developer page. An old page asking for a
 * file that a deploy removed reloads itself; anything else says so plainly and offers a retry.
 */
export function RouteError() {
  const error = useRouteError();
  const stale = isStaleFileError(error);
  const reloading = stale && !reloadedRecently();

  useEffect(() => {
    if (reloading) reloadForNewVersion();
  }, [reloading]);

  if (reloading) return <Splash />;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-start justify-center gap-4 px-5">
      <h1 className="text-2xl font-bold">
        {t(stale ? "error.newVersion.title" : "error.generic.title")}
      </h1>
      <p className="text-ink-muted">{t(stale ? "error.newVersion.body" : "error.generic.body")}</p>
      <button
        type="button"
        onClick={() => {
          window.location.reload();
        }}
        className="press-pill rounded-full bg-sprout-500 px-6 py-3 font-bold text-white"
      >
        {t("error.reload")}
      </button>
    </main>
  );
}
