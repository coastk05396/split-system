import type { ReactNode } from "react";
import { type MessageId, t } from "../i18n/messages.js";

/** A tab whose screen lands in a later ticket. */
export function PlaceholderPage({ title, children }: { title: MessageId; children?: ReactNode }) {
  return (
    <section>
      <h1 className="text-2xl font-bold md:text-3xl">{t(title)}</h1>
      <p className="mt-2 text-ink-muted">{t("page.comingSoon")}</p>
      {children}
    </section>
  );
}
