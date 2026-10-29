import { type CurrencyCode, formatAmount, type SplitMethod } from "@split/shared";
import { Avatar, card } from "../groups/ui.js";
import { type MessageId, t } from "../i18n/messages.js";
import { evaluateSplit, type SplitDraft, type SplitStatus } from "./split-draft.js";

export interface SplitMember {
  id: string;
  displayName: string;
  placeholder?: boolean;
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
  const toggle = (id: string) => {
    onChange({
      ...value,
      included: included.has(id) ? value.included.filter((x) => x !== id) : [...value.included, id],
    });
  };

  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-3 text-lg font-bold">{t("split.title")}</legend>
      <div className="grid grid-cols-3 gap-2">
        {METHODS.map((method) => (
          <label
            key={method}
            className={`flex cursor-pointer flex-col gap-0.5 rounded-2xl border p-3 has-[:checked]:border-sprout-500 has-[:checked]:bg-sprout-100 ${card}`}
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
      <div className="flex items-center justify-between">
        <span className="font-bold">{t("split.participants")}</span>
        <span className="flex items-center gap-3 text-sm">
          <span className="text-sprout-600">
            {t("split.checked", { count: included.size, total: members.length })}
          </span>
          <button
            type="button"
            className="rounded-full border border-sprout-200 px-3 py-1 font-bold"
            onClick={() => {
              onChange({ ...value, included: order });
            }}
          >
            {t("split.selectAll")}
          </button>
        </span>
      </div>
      <ul className="flex flex-col gap-2">
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
      <p
        role="status"
        className={`text-sm font-bold ${status.kind === "balanced" ? "text-sprout-600" : "text-red-700"}`}
      >
        {statusText(status, currency)}
      </p>
    </fieldset>
  );
}
