import { type CurrencyCode, formatAmount } from "@split/shared";
import { AvatarTip, card } from "../groups/ui.js";
import { localName } from "../i18n/format.js";
import { t } from "../i18n/messages.js";
import { CountUp } from "../shell/CountUp.js";
import type { BalanceRow } from "./model.js";

/**
 * 大家的結餘: everyone still owing or owed, as bars out of a centre line: red to the left for
 * what they pay, green to the right for what they get, the length following the amount.
 */
export function BalanceChart({
  rows,
  myMemberId,
  currency,
  pictureOf,
}: {
  rows: readonly BalanceRow[];
  myMemberId: string;
  currency: CurrencyCode;
  pictureOf: (id: string) => string | null;
}) {
  const seated = rows.filter((r) => r.status !== "former");
  const open = seated.filter((r) => r.balance !== 0).sort((a, b) => b.balance - a.balance);
  if (open.length === 0) return null;
  const settled = seated.length - open.length;
  const largest = Math.max(...open.map((r) => Math.abs(r.balance)));

  return (
    <section aria-labelledby="balance-chart" className={`${card} flex flex-col gap-3 p-5`}>
      <div>
        <h2 id="balance-chart" className="text-lg font-bold">
          {t("settle.chartTitle")}
        </h2>
        <p className="text-sm text-ink-muted">{t("settle.chartLegend")}</p>
      </div>
      <ul aria-label={t("settle.chartTitle")} className="flex flex-col gap-3">
        {open.map((r, index) => {
          const owed = r.balance > 0;
          const name = localName(r.displayName);
          // Rows set off one after another, capped so a long list is not a long wait.
          const delay = `${String(Math.min(index, 6) * 60)}ms`;
          const width = `${String(Math.max(4, Math.round((Math.abs(r.balance) / largest) * 100)))}%`;
          return (
            <li
              key={r.memberId}
              className={`flex flex-col gap-1 rounded-xl px-2 py-1 ${
                r.memberId === myMemberId ? "bg-sprout-100" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  <AvatarTip
                    name={name}
                    pictureUrl={pictureOf(r.memberId)}
                    placeholder={r.status === "placeholder"}
                    isMe={r.memberId === myMemberId}
                    className="size-9"
                  />
                  <span className="min-w-0 truncate text-sm font-bold text-ink">{name}</span>
                </div>
                <span
                  className={`shrink-0 font-bold tabular-nums ${owed ? "text-sprout-600" : "text-red-700"}`}
                >
                  <CountUp
                    value={r.balance}
                    format={(n) => `${n > 0 ? "+" : ""}${formatAmount(n, currency)}`}
                  />
                </span>
              </div>
              <div aria-hidden="true" className="grid grid-cols-2">
                <div className="flex justify-end border-r-2 border-ink/30">
                  {!owed && (
                    <div
                      className="bar-grow-left h-3 rounded-l-full bg-red-400"
                      style={{ width, animationDelay: delay }}
                    />
                  )}
                </div>
                <div className="flex">
                  {owed && (
                    <div
                      className="bar-grow-right h-3 rounded-r-full bg-sprout-500"
                      style={{ width, animationDelay: delay }}
                    />
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {settled > 0 && (
        <p className="text-sm text-ink-muted">{t("settle.chartSettled", { count: settled })}</p>
      )}
    </section>
  );
}
