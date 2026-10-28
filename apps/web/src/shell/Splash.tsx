import { t } from "../i18n/messages.js";
import { SproutMark } from "./SproutMark.js";

export function Splash() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3" role="status">
      <SproutMark className="size-14" />
      <p className="text-sm text-ink-muted">{t("app.loading")}</p>
    </div>
  );
}
