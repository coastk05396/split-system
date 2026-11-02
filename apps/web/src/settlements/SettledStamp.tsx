import { t } from "../i18n/messages.js";

/** A quiet ledger seal, shown only once all confirmed balances are square. */
export function SettledStamp() {
  return (
    <span className="settled-stamp" role="status" aria-label={`${t("groups.settled")} · SETTLED`}>
      <span>{t("groups.settled")}</span>
      <span className="text-[9px] tracking-[0.18em]" aria-hidden="true">
        SETTLED
      </span>
    </span>
  );
}
