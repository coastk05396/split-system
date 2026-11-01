import { t } from "../i18n/messages.js";
import { SproutMascot } from "./SproutMascot.js";

export function Splash() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3" role="status">
      <span className="sprout-sway inline-flex">
        <SproutMascot className="size-20" mood="happy" interactive={false} />
      </span>
      <p className="text-sm font-bold text-ink-muted">{t("app.loading")}</p>
    </div>
  );
}
