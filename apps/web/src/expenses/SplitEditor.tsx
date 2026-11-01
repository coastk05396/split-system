import { type CurrencyCode, formatAmount, type SplitMethod } from "@split/shared";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { Avatar, card } from "../groups/ui.js";
import { type MessageId, t } from "../i18n/messages.js";
import { ShareBar, ShareRing } from "./ShareRing.js";
import { evaluateSplit, type SplitDraft, type SplitStatus } from "./split-draft.js";

export interface SplitMember {
  id: string;
  displayName: string;
  placeholder?: boolean;
  pictureUrl?: string | null;
}

// Not SPLIT_METHODS from @split/shared: a value import from expense.ts brings Zod into this chunk.
const METHODS: readonly SplitMethod[] = ["equal", "exact", "shares"];

const METHOD_LABELS: Record<SplitMethod, { label: MessageId; hint: MessageId }> = {
  equal: { label: "split.method.equal", hint: "split.method.equalHint" },
  exact: { label: "split.method.exact", hint: "split.method.exactHint" },
  shares: { label: "split.method.shares", hint: "split.method.sharesHint" },
};

function statusText(status: SplitStatus, currency: CurrencyCode): string {
  switch (status.kind) {
    case "needAmount":
      return t("split.needAmount");
    case "noParticipants":
      return t("split.noParticipants");
    case "amountInvalid":
      return t("split.amountInvalid");
    case "sharesInvalid":
      return t("split.sharesInvalid");
    case "remaining":
      return t("split.remaining", { amount: formatAmount(status.amountMinor, currency) });
    case "over":
      return t("split.over", { amount: formatAmount(status.amountMinor, currency) });
    case "balanced":
      return t("split.balanced");
  }
}

const fieldClass =
  "w-20 rounded-xl border border-sprout-200 bg-white px-2 py-1.5 text-right outline-none focus:border-sprout-500";

/**
 * Screen 30 as amended (decision 23): equal, exact amount or Shares, everyone checked by
 * default with a 全選/清空 pill, and a live line saying what is left until the split balances.
 */
export function SplitEditor({
  members,
  amountMinor,
  currency,
  payerIds,
  value,
  onChange,
}: {
  members: readonly SplitMember[];
  amountMinor: number | null;
  currency: CurrencyCode;
  payerIds: readonly string[];
  value: SplitDraft;
  onChange: (next: SplitDraft) => void;
}) {
  const order = members.map((m) => m.id);
  const { amounts, status } = evaluateSplit(value, amountMinor, currency, order, payerIds);
  const included = new Set(value.included);
  // Each person's share in the order of the list, for the ring: 0 for anyone not sharing.
  const shares = members.map((m) => amounts.get(m.id) ?? 0);
  const toggle = (id: string) => {
    onChange({
      ...value,
      included: included.has(id) ? value.included.filter((x) => x !== id) : [...value.included, id],
    });
  };

  // Equal splits keep the people behind a dropdown; exact and Shares need every row in sight.
  const equal = value.method === "equal";
  const [open, setOpen] = useState(false);
  const isExpanded = !equal || open;
  const [rendered, setRendered] = useState(isExpanded);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (isExpanded) {
      setRendered(true);
      setClosing(false);
    } else if (rendered) {
      setClosing(true);
      const timer = setTimeout(() => {
        setRendered(false);
        setClosing(false);
      }, 220);
      return () => {
        clearTimeout(timer);
      };
    }
  }, [isExpanded, rendered]);
  // One pill for both directions, so it never needs a second button: 清空 while everyone is in.
  const everyoneIn = included.size === members.length;
  const toggleAll = (
    <button
      type="button"
      className="press-pill rounded-full bg-sprout-100 px-3 py-1 text-sm font-bold text-sprout-600 hover:bg-sprout-200"
      onClick={() => {
        onChange({ ...value, included: everyoneIn ? [] : order });
      }}
    >
      <span key={String(everyoneIn)} className="swap-in">
        {everyoneIn ? t("split.clear") : t("split.selectAll")}
      </span>
    </button>
  );

  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-3 text-lg font-bold">{t("split.title")}</legend>
      <div className="grid grid-cols-3 gap-2">
        {METHODS.map((method) => (
          <label
            key={method}
            className={`press-card flex cursor-pointer flex-col gap-0.5 rounded-2xl border p-3 hover:border-sprout-500 has-[:checked]:border-sprout-500 has-[:checked]:bg-sprout-100 ${card}`}
          >
            <input
              type="radio"
              name="split-method"
              className="sr-only"
              checked={value.method === method}
              onChange={() => {
                onChange({ ...value, method });
              }}
            />
            <span className="font-bold">{t(METHOD_LABELS[method].label)}</span>
            <span className="text-xs text-ink-muted">{t(METHOD_LABELS[method].hint)}</span>
          </label>
        ))}
      </div>
      {equal ? (
        // The pill hugs the title on the left, so the count changing width never moves it.
        <div className={`${card} flex items-center gap-2 py-1.5 pl-4`}>
          <span className="font-bold">{t("split.participants")}</span>
          {toggleAll}
          <button
            type="button"
            aria-expanded={open}
            aria-label={t("split.participants")}
            onClick={() => {
              setOpen(!open);
            }}
            className="flex flex-1 items-center justify-end gap-2 py-1.5 pr-4 text-sm text-sprout-600"
          >
            <ShareRing shares={shares} />
            <span key={included.size} className="swap-in">
              {everyoneIn
                ? t("split.allPeople", { count: members.length })
                : t("split.checked", { count: included.size, total: members.length })}
            </span>
            <ChevronDown
              aria-hidden="true"
              className={`size-4 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
            />
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <span className="font-bold">{t("split.participants")}</span>
            {toggleAll}
          </span>
          <span className="flex items-center gap-3 text-sm">
            <ShareRing shares={shares} />
            <span className="text-sprout-600">
              {t("split.checked", { count: included.size, total: members.length })}
            </span>
          </span>
        </div>
      )}
      <ShareBar shares={shares} />
      {rendered && (
        <div className="collapse-grid" data-closing={closing ? "true" : undefined}>
          <div className="collapse-grid-inner">
            <ul className="flex flex-col gap-2 pt-1 pb-0.5">
              {members.map((m) => {
                const takesPart = included.has(m.id);
                const amount = amounts.get(m.id);
                return (
                  <li
                    key={m.id}
                    aria-label={m.displayName}
                    className={`${card} flex items-center gap-3 px-4 py-3`}
                  >
                    <Avatar
                      name={m.displayName}
                      pictureUrl={m.pictureUrl ?? null}
                      placeholder={m.placeholder ?? false}
                      className="size-9"
                    />
                    <span className="min-w-0 flex-1 truncate font-bold">{m.displayName}</span>
                    {takesPart && value.method === "exact" && (
                      <input
                        aria-label={t("split.amountOf", { name: m.displayName })}
                        inputMode="decimal"
                        className={fieldClass}
                        value={value.exact[m.id] ?? ""}
                        onChange={(e) => {
                          onChange({ ...value, exact: { ...value.exact, [m.id]: e.target.value } });
                        }}
                      />
                    )}
                    {takesPart && value.method === "shares" && (
                      <input
                        aria-label={t("split.sharesOf", { name: m.displayName })}
                        inputMode="numeric"
                        className={fieldClass}
                        value={value.shares[m.id] ?? "1"}
                        onChange={(e) => {
                          onChange({ ...value, shares: { ...value.shares, [m.id]: e.target.value } });
                        }}
                      />
                    )}
                    {takesPart && value.method !== "exact" && amount !== undefined && (
                      <span className="text-sm font-bold text-sprout-600">
                        {formatAmount(amount, currency)}
                      </span>
                    )}
                    {!takesPart && <span className="text-sm text-ink-muted">{t("split.notIn")}</span>}
                    <input
                      type="checkbox"
                      aria-label={t("split.takesPart", { name: m.displayName })}
                      className="size-5 accent-sprout-500"
                      checked={takesPart}
                      onChange={() => {
                        toggle(m.id);
                      }}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
      <p
        role="status"
        className={`flex items-center gap-1.5 self-start rounded-full px-3 py-1 text-sm font-bold transition-colors ${
          status.kind === "balanced" ? "bg-sprout-100 text-sprout-700" : "bg-red-50 text-red-700"
        }`}
      >
        {status.kind === "balanced" && (
          <Check aria-hidden="true" className="settle-pop size-4 shrink-0 text-sprout-600" />
        )}
        {statusText(status, currency)}
      </p>
    </fieldset>
  );
}
