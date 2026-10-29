import { type CurrencyCode, formatAmount, type SplitMethod } from "@split/shared";
import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
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
 * default with 全選, and a live line saying what is left until the split balances.
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
  const selectAll = (
    <button
      type="button"
      className="press-pill rounded-full border border-sprout-200 px-3 py-1 font-bold hover:border-sprout-500"
      onClick={() => {
        onChange({ ...value, included: order });
      }}
    >
      {t("split.selectAll")}
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
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
          }}
          className={`${card} flex items-center justify-between px-4 py-3`}
        >
          <span className="font-bold">{t("split.participants")}</span>
          <span className="flex items-center gap-2 text-sm text-sprout-600">
            <ShareRing shares={shares} />
            {included.size === members.length
              ? t("split.allPeople", { count: members.length })
              : t("split.checked", { count: included.size, total: members.length })}
            <ChevronDown
              aria-hidden="true"
              className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
            />
          </span>
        </button>
      ) : (
        <div className="flex items-center justify-between">
          <span className="font-bold">{t("split.participants")}</span>
          <span className="flex items-center gap-3 text-sm">
            <ShareRing shares={shares} />
            <span className="text-sprout-600">
              {t("split.checked", { count: included.size, total: members.length })}
            </span>
            {selectAll}
          </span>
        </div>
      )}
      {equal && open && <div className="collapse-enter flex justify-end">{selectAll}</div>}
      <ShareBar shares={shares} />
      {(!equal || open) && (
        <ul className="collapse-enter flex flex-col gap-2">
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
