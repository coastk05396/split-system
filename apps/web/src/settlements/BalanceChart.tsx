import { type CurrencyCode, formatAmount } from "@split/shared";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { AvatarTip } from "../groups/ui.js";
import { localName } from "../i18n/format.js";
import { t } from "../i18n/messages.js";
import { CountUp } from "../shell/CountUp.js";
import type { BalanceRow } from "./model.js";

/**
 * 大家的結餘: everyone still owing or owed, as bars out of a centre line: red to the left for
 * what they pay, green to the right for what they get, the length following the amount.
 * Pre-collapsed as an accordion to keep the screen focused on actionable payment rows.
 */
export function BalanceChart({
  rows,
  myMemberId,
  currency,
  pictureOf,
  updating = false,
  defaultOpen = true,
}: {
  rows: readonly BalanceRow[];
  myMemberId: string;
  currency: CurrencyCode;
  pictureOf: (id: string) => string | null;
  updating?: boolean | undefined;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [animKey, setAnimKey] = useState(0);
  const seated = rows.filter((r) => r.status !== "former");
  const open = seated.filter((r) => r.balance !== 0).sort((a, b) => b.balance - a.balance);
  if (open.length === 0) return null;
  const settled = seated.length - open.length;
  const largest = Math.max(...open.map((r) => Math.abs(r.balance)));

  return (
    <section aria-labelledby="balance-chart" className="surface-card settle-stagger-1 flex flex-col rounded-3xl border border-sprout-200 bg-white p-5">
      <button
        type="button"
        id="balance-chart"
        aria-expanded={isOpen}
        onClick={() => {
          setIsOpen((prev) => {
            const next = !prev;
            if (next) {
              setAnimKey((k) => k + 1);
            }
            return next;
          });
        }}
        className="press-pill flex w-full items-center justify-between text-left select-none rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sprout-600"
      >
        <h2 className="text-lg font-bold text-ink">
          {t("settle.chartTitle")}
        </h2>
        <span className="press-icon flex size-8 shrink-0 items-center justify-center rounded-full text-sprout-700 hover:bg-sprout-100">
          <ChevronDown
            aria-hidden="true"
            className={`size-5 transition-transform duration-220 ease-(--ease-spring) ${
              isOpen ? "rotate-180" : ""
            }`}
          />
        </span>
      </button>

      <div
        className="collapse-grid"
        data-closing={!isOpen ? "true" : undefined}
        inert={!isOpen}
      >
        <div className="collapse-grid-inner pt-3">
          <ul key={animKey} aria-label={t("settle.chartTitle")} className="flex flex-col gap-3">
            {open.map((r, index) => {
              const owed = r.balance > 0;
              const name = localName(r.displayName);
              // Rows set off one after another, capped so a long list is not a long wait.
              const delay = `${String(Math.min(index, 6) * 60)}ms`;
              const width = `${String(Math.max(4, Math.round((Math.abs(r.balance) / largest) * 85)))}%`;
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
                    <CountUp
                      value={r.balance}
                      format={(n) => `${n > 0 ? "+" : ""}${formatAmount(n, currency)}`}
                      goodWhen="up"
                      updating={updating}
                      className={`shrink-0 font-bold tabular-nums ${owed ? "text-sprout-600" : "text-red-700"}`}
                    />
                  </div>
                  <div aria-hidden="true" className="mx-auto grid w-full max-w-[92%] grid-cols-2 px-1">
                    <div className="flex justify-end border-r-2 border-ink/30 pr-0.5">
                      {!owed && (
                        <div
                          className="bar-grow-left h-3 rounded-l-full bg-red-700"
                          style={{ width, animationDelay: delay }}
                        />
                      )}
                    </div>
                    <div className="flex pl-0.5">
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
            <p className="mt-3 text-sm text-ink-muted">{t("settle.chartSettled", { count: settled })}</p>
          )}
        </div>
      </div>
    </section>
  );
}
