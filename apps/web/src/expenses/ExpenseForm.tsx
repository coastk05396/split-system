import * as Menu from "@radix-ui/react-dropdown-menu";
import * as Tabs from "@radix-ui/react-tabs";
import { Link } from "react-router";
import {
  CURRENCY_CODES,
  type CurrencyCode,
  type Expense,
  formatAmount,
  formatRate,
  type Group,
  type Member,
} from "@split/shared";
import { ArrowRight, Check, ChevronDown, Users } from "lucide-react";
import { type SubmitEvent, useEffect, useRef, useState } from "react";
import { ApiFailure } from "../api/errors.js";
import { useDeps } from "../app/AppProviders.js";
import { Odometer } from "../shell/Odometer.js";
import { SelectionPill } from "../shell/SelectionPill.js";
import { CategoryIcon, categoryTone } from "./CategoryIcon.js";
import { Avatar, card, failureMessage, input, primaryButton } from "../groups/ui.js";
import { categoryLabel, localName } from "../i18n/format.js";
import { errorMessage, t } from "../i18n/messages.js";
import { TRIP_ENABLED } from "../trip/enabled.js";
import { useRate, useSaveExpense, useStops } from "./api.js";
import {
  CATEGORIES,
  type ConversionState,
  type DraftEvaluation,
  evaluateDraft,
  type ExpenseDraft,
  expenseDraftFrom,
  newExpenseDraft,
} from "./expense-draft.js";
import { SplitEditor, type SplitMember } from "./SplitEditor.js";

const label = "text-sm font-bold";

/**
 * Screen 4 as amended (decision 23): 花費 and 轉帳 tabs, the calculator amount with a TWD/USD
 * picker, rate and typed converted amount, date and optional time, category and name, the
 * Stop link on Trips, several payers, and the split editor. Every create carries one
 * Idempotency-Key that a retry reuses, so a lost answer never records the Expense twice.
 */
export function ExpenseForm({
  group,
  members,
  expense,
  startCurrency,
  onSaved,
}: {
  group: Group;
  members: readonly Member[];
  /** The Expense being edited; a new one when absent. */
  expense?: Expense;
  /** The currency a new Expense starts in; the Settlement currency when absent. */
  startCurrency?: CurrencyCode;
  /** `sendToChat` says whether to post it into the LINE chat the app was opened from. */
  onSaved: (expense: Expense, options: { sendToChat: boolean }) => void | Promise<void>;
}) {
  const { line } = useDeps();
  const selectable: SplitMember[] = members
    .filter((m) => m.status !== "former")
    .map((m) => ({
      id: m.id,
      displayName: localName(m.displayName),
      placeholder: m.status === "placeholder",
      pictureUrl: m.pictureUrl,
    }));
  const order = selectable.map((m) => m.id);
  const [activeKind, setActiveKind] = useState<"spend" | "settlement">("spend");
  const [draft, setDraft] = useState<ExpenseDraft>(() =>
    expense === undefined
      ? newExpenseDraft({
          currency: startCurrency ?? group.settlementCurrency,
          myMemberId: group.me.memberId,
          memberIds: order,
          now: new Date(),
        })
      : expenseDraftFrom(expense, group.settlementCurrency),
  );
  // Only a new Expense opened from a LINE chat can be posted back into that chat.
  const [chatAvailable, setChatAvailable] = useState(false);
  const [sendToChat, setSendToChat] = useState(false);
  // Saved, but the caller is still finishing (posting to the chat): no second submit meanwhile.
  const [finishing, setFinishing] = useState(false);
  useEffect(() => {
    if (expense !== undefined) return;
    let current = true;
    void line.canSendToChat().then((available) => {
      if (current) setChatAvailable(available);
    });
    return () => {
      current = false;
    };
  }, [expense, line]);
  // One key for this form's create, kept across retries (decision 15).
  const idempotencyKey = useRef(crypto.randomUUID());
  const rate = useRate(draft.date, draft.currency, group.settlementCurrency);
  const save = useSaveExpense(group.id);
  const evaluation = evaluateDraft(draft, {
    settlementCurrency: group.settlementCurrency,
    memberOrder: order,
    reference: rate.data,
  });
  const update = (patch: Partial<ExpenseDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
  };

  const onSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = evaluation.input;
    if (body === null || save.isPending || finishing) return;
    save.mutate(
      expense === undefined
        ? { kind: "create", input: body, idempotencyKey: idempotencyKey.current }
        : { kind: "edit", input: body, expense },
      {
        onSuccess: (saved) => {
          setFinishing(true);
          void Promise.resolve(onSaved(saved, { sendToChat })).finally(() => {
            setFinishing(false);
          });
        },
      },
    );
  };

  return (
    <Tabs.Root
      value={activeKind}
      onValueChange={(v) => {
        if (v === "spend" || v === "settlement") setActiveKind(v);
      }}
      className="flex flex-col gap-6"
    >
      <Tabs.List
        aria-label={t("expense.kind")}
        className="flex gap-1 rounded-2xl bg-sprout-150 p-1"
      >
        {(["spend", "settlement"] as const).map((kind) => (
          <Tabs.Trigger
            key={kind}
            value={kind}
            className="relative flex-1 rounded-xl py-2.5 text-ink-muted transition-colors data-[state=active]:font-bold data-[state=active]:text-ink"
          >
            {activeKind === kind && (
              <SelectionPill
                layoutId="expense-kind-selection"
                className="inset-0 rounded-xl bg-white shadow-[0_3px_10px_-7px_#143f2a]"
              />
            )}
            <span className="relative">
              {t(kind === "spend" ? "expense.tab.spend" : "expense.tab.settlement")}
            </span>
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      <Tabs.Content value="settlement" className="tab-panel">
        <div className={`${card} flex flex-col items-center gap-3 p-5 text-center`}>
          <p className="text-ink-muted">{t("expense.settlementHint")}</p>
          <Link
            to={`/groups/${group.id}?tab=settle`}
            className={`${primaryButton} inline-flex items-center gap-2 px-4 py-2`}
          >
            {t("expense.goToSettlement")}
          </Link>
        </div>
      </Tabs.Content>
      <Tabs.Content value="spend" className="tab-panel">
        <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
          <AmountSection
            draft={draft}
            evaluation={evaluation}
            settlementCurrency={group.settlementCurrency}
            rate={{
              loading: rate.isFetching,
              unavailable: rate.isError,
              date: rate.data?.rateDate,
              stale: rate.data?.stale === true,
            }}
            update={update}
          />
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className={label}>{t("expense.date")}</span>
              <input
                type="date"
                required
                className={input}
                value={draft.date}
                onChange={(e) => {
                  update({ date: e.target.value, stopId: null });
                }}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={label}>{t("expense.time")}</span>
              <input
                type="time"
                className={input}
                value={draft.time}
                onChange={(e) => {
                  update({ time: e.target.value });
                }}
              />
            </label>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className={`${label} mb-2`}>{t("expense.category")}</legend>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((category) => (
                <label
                  key={category}
                  className={`press-pill flex cursor-pointer items-center gap-1.5 rounded-full border border-sprout-200 bg-white px-4 py-1.5 hover:border-sprout-500 has-[:checked]:font-bold ${categoryTone(category).chip}`}
                >
                  <input
                    type="radio"
                    name="category"
                    className="sr-only"
                    checked={draft.category === category}
                    onChange={() => {
                      update({ category });
                    }}
                  />
                  <span
                    className={`flex size-5 items-center justify-center rounded-full ${categoryTone(category).badge}`}
                  >
                    <CategoryIcon category={category} className="size-3.5" />
                  </span>
                  {categoryLabel(category)}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex flex-col gap-1">
            <span className={label}>{t("expense.name")}</span>
            <input
              className={input}
              required
              maxLength={100}
              placeholder={t("expense.namePlaceholder")}
              value={draft.description}
              onChange={(e) => {
                update({ description: e.target.value });
              }}
            />
          </label>
          {group.isTrip && TRIP_ENABLED && (
            <StopPicker
              groupId={group.id}
              day={draft.date}
              value={draft.stopId}
              onChange={(stopId) => {
                update({ stopId });
              }}
            />
          )}
          <PayersSection
            members={selectable}
            myMemberId={group.me.memberId}
            draft={draft}
            evaluation={evaluation}
            update={update}
          />
          <SplitEditor
            members={selectable}
            amountMinor={evaluation.amount.kind === "ok" ? evaluation.amount.amountMinor : null}
            currency={draft.currency}
            payerIds={
              evaluation.payers.kind === "balanced"
                ? evaluation.payers.lines.map((l) => l.memberId)
                : []
            }
            value={draft.split}
            onChange={(split) => {
              update({ split });
            }}
          />
          {save.isError && (
            <p role="alert" className="rounded-2xl bg-peach p-4 font-bold">
              {save.error instanceof ApiFailure
                ? failureMessage(save.error)
                : t("expense.networkError")}
            </p>
          )}
          {chatAvailable && (
            <label className="press-card flex cursor-pointer items-center gap-3 rounded-2xl bg-sprout-150 px-4 py-3 font-bold">
              <input
                type="checkbox"
                checked={sendToChat}
                onChange={(e) => {
                  setSendToChat(e.target.checked);
                }}
                className="size-5 accent-sprout-500"
              />
              <span aria-hidden="true">💬</span>
              {t("expenseShare.sendToChat")}
            </label>
          )}
          <button
            type="submit"
            className={`${primaryButton} justify-between`}
            disabled={evaluation.input === null || save.isPending || finishing}
          >
            {save.isPending || finishing
              ? t("expense.saving")
              : t(expense === undefined ? "expense.submit" : "expense.save")}
            <ArrowRight aria-hidden="true" className="size-5" />
          </button>
        </form>
      </Tabs.Content>
    </Tabs.Root>
  );
}

function AmountSection({
  draft,
  evaluation,
  settlementCurrency,
  rate,
  update,
}: {
  draft: ExpenseDraft;
  evaluation: DraftEvaluation;
  settlementCurrency: CurrencyCode;
  rate: { loading: boolean; unavailable: boolean; date: string | undefined; stale?: boolean };
  update: (patch: Partial<ExpenseDraft>) => void;
}) {
  const { amount, conversion } = evaluation;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-end gap-3 border-b-2 border-sprout-500 pb-2">
        <CurrencyPicker
          value={draft.currency}
          onChange={(currency) => {
            update({ currency, conversion: { source: "reference" } });
          }}
        />
        <label className="flex min-w-0 flex-1 flex-col items-end">
          <span className="sr-only">{t("expense.amount")}</span>
          <input
            inputMode="decimal"
            autoComplete="off"
            className="w-full bg-transparent text-right text-4xl font-bold text-sprout-900 outline-none"
            placeholder={t("expense.amountPlaceholder")}
            value={draft.amountText}
            onChange={(e) => {
              update({ amountText: e.target.value });
            }}
          />
        </label>
      </div>
      {amount.kind === "ok" && amount.isExpression && (
        <p className="text-right font-bold text-sprout-600">
          <Odometer
            text={t("expense.result", { amount: formatAmount(amount.amountMinor, draft.currency) })}
          />
        </p>
      )}
      {amount.kind === "error" && (
        <p className="text-right text-sm font-bold text-red-700">
          {amount.error === "EXPENSE_AMOUNT_INVALID"
            ? errorMessage("EXPENSE_AMOUNT_INVALID")
            : t(`expense.calc.${amount.error}`)}
        </p>
      )}
      {conversion.kind !== "same" && (
        <ConversionFields
          draft={draft}
          conversion={conversion}
          settlementCurrency={settlementCurrency}
          rate={rate}
          update={update}
        />
      )}
    </section>
  );
}

function CurrencyPicker({
  value,
  onChange,
}: {
  value: CurrencyCode;
  onChange: (currency: CurrencyCode) => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`${t("expense.currency")} ${value}`}
        className="flex items-center gap-1 rounded-xl px-2 py-1 text-xl font-bold text-ink-muted"
      >
        {value}
        <ChevronDown aria-hidden="true" className="size-4" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="start"
          sideOffset={6}
          className="menu-content z-20 min-w-40 rounded-2xl border border-sprout-200/90 p-1"
        >
          <Menu.RadioGroup
            value={value}
            onValueChange={(next) => {
              const code = CURRENCY_CODES.find((c) => c === next);
              if (code !== undefined) onChange(code);
            }}
          >
            {CURRENCY_CODES.map((code) => (
              <Menu.RadioItem
                key={code}
                value={code}
                className="cursor-pointer rounded-xl px-4 py-2.5 outline-none data-[highlighted]:bg-sprout-100 data-[state=checked]:font-bold"
              >
                {t(`currency.${code}`)}
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function ConversionFields({
  draft,
  conversion,
  settlementCurrency,
  rate,
  update,
}: {
  draft: ExpenseDraft;
  conversion: Exclude<ConversionState, { kind: "same" }>;
  settlementCurrency: CurrencyCode;
  rate: { loading: boolean; unavailable: boolean; date: string | undefined; stale?: boolean };
  update: (patch: Partial<ExpenseDraft>) => void;
}) {
  const rateText =
    draft.conversion.source === "rate"
      ? draft.conversion.text
      : conversion.kind === "waiting"
        ? ""
        : conversion.rateText;
  const convertedText =
    draft.conversion.source === "converted"
      ? draft.conversion.text
      : conversion.kind === "waiting"
        ? ""
        : conversion.convertedText;
  return (
    <div className={`${card} flex flex-col gap-3 p-4`}>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className={label}>{t("expense.rate")}</span>
          <input
            inputMode="decimal"
            className={input}
            value={rateText}
            onChange={(e) => {
              update({ conversion: { source: "rate", text: e.target.value } });
            }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>{t("expense.converted", { currency: settlementCurrency })}</span>
          <input
            inputMode="decimal"
            className={input}
            value={convertedText}
            onChange={(e) => {
              update({ conversion: { source: "converted", text: e.target.value } });
            }}
          />
        </label>
      </div>
      <div className="text-xs text-ink-muted">
        {draft.conversion.source !== "reference" ? (
          <p>{t("expense.rateCustom")}</p>
        ) : rate.loading ? (
          <p>{t("expense.rateLoading")}</p>
        ) : rate.unavailable ? (
          <p>{errorMessage("RATE_UNAVAILABLE")}</p>
        ) : conversion.kind === "ok" ? (
          <p className="flex flex-wrap items-center gap-2">
            <span>
              {t("expense.rateHint", {
                base: draft.currency,
                quote: settlementCurrency,
                rate: formatRate(conversion.rateScaled),
                date: rate.date ?? draft.date,
              })}
            </span>
            {rate.stale && (
              <span className="rounded-full bg-peach px-2 py-0.5 text-xs font-bold text-sprout-800">
                {t("expense.rateStale", { date: rate.date ?? draft.date })}
              </span>
            )}
          </p>
        ) : null}
      </div>
      {conversion.kind === "invalid" && (
        <p className="text-sm font-bold text-red-700">{t("expense.conversionInvalid")}</p>
      )}
    </div>
  );
}

function StopPicker({
  groupId,
  day,
  value,
  onChange,
}: {
  groupId: string;
  day: string;
  value: string | null;
  onChange: (stopId: string | null) => void;
}) {
  const stops = useStops(groupId, day, true);
  return (
    <label className="flex flex-col gap-1">
      <span className={label}>{t("expense.stop")}</span>
      <select
        className={input}
        value={value ?? ""}
        onChange={(e) => {
          onChange(e.target.value === "" ? null : e.target.value);
        }}
      >
        <option value="">{t("expense.noStop")}</option>
        {(stops.data ?? []).map((stop) => (
          <option key={stop.id} value={stop.id}>
            {stop.startTime === null ? stop.title : `${stop.startTime} ${stop.title}`}
          </option>
        ))}
      </select>
    </label>
  );
}

/** One payer, chosen from a menu in the same style as the currency picker. */
function PayerPicker({
  members,
  value,
  onChange,
}: {
  members: readonly SplitMember[];
  value: string;
  onChange: (memberId: string) => void;
}) {
  const current = members.find((m) => m.id === value);
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`${t("expense.payers")} ${current?.displayName ?? ""}`}
        className={`${card} flex w-full items-center gap-3 px-4 py-3 text-left data-[state=open]:border-sprout-500`}
      >
        <Avatar
          name={current?.displayName ?? "?"}
          pictureUrl={current?.pictureUrl ?? null}
          placeholder={current?.placeholder ?? false}
          className="size-9"
        />
        <span className="min-w-0 flex-1 truncate text-lg font-bold">{current?.displayName}</span>
        <ChevronDown aria-hidden="true" className="size-5 text-ink-muted" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="start"
          sideOffset={6}
          className="menu-content z-20 max-h-72 w-(--radix-dropdown-menu-trigger-width) overflow-y-auto rounded-2xl border border-sprout-200/90 p-1"
        >
          <Menu.RadioGroup value={value} onValueChange={onChange}>
            {members.map((m) => (
              <Menu.RadioItem
                key={m.id}
                value={m.id}
                className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 outline-none data-[highlighted]:bg-sprout-100 data-[state=checked]:font-bold"
              >
                <Avatar
                  name={m.displayName}
                  pictureUrl={m.pictureUrl ?? null}
                  placeholder={m.placeholder ?? false}
                  className="size-8 text-sm"
                />
                <span className="min-w-0 flex-1 truncate">{m.displayName}</span>
                <Menu.ItemIndicator>
                  <Check aria-hidden="true" className="size-5 text-sprout-600" />
                </Menu.ItemIndicator>
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function PayersSection({
  members,
  myMemberId,
  draft,
  evaluation,
  update,
}: {
  members: readonly SplitMember[];
  myMemberId: string;
  draft: ExpenseDraft;
  evaluation: DraftEvaluation;
  update: (patch: Partial<ExpenseDraft>) => void;
}) {
  const { payers } = draft;
  const status = evaluation.payers;
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-3 flex w-full items-center justify-between text-lg font-bold">
        {t("expense.payers")}
      </legend>
      <button
        type="button"
        aria-pressed={payers.mode === "several"}
        className="flex items-center gap-2 self-end rounded-full border border-sprout-200 px-3 py-1 text-sm font-bold"
        onClick={() => {
          update({
            payers:
              payers.mode === "single"
                ? { mode: "several", amounts: {} }
                : { mode: "single", memberId: myMemberId },
          });
        }}
      >
        <Users aria-hidden="true" className="size-4" />
        {t(payers.mode === "single" ? "expense.severalPayers" : "expense.onePayer")}
      </button>
      {payers.mode === "single" ? (
        <PayerPicker
          members={members}
          value={payers.memberId}
          onChange={(memberId) => {
            update({ payers: { mode: "single", memberId } });
          }}
        />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {members.map((m) => (
              <li key={m.id} className={`${card} flex items-center gap-3 px-4 py-2`}>
                <span className="min-w-0 flex-1 truncate font-bold">{m.displayName}</span>
                <input
                  aria-label={t("expense.paidAmountOf", { name: m.displayName })}
                  inputMode="decimal"
                  className="w-24 rounded-xl border border-sprout-200 px-2 py-1.5 text-right outline-none focus:border-sprout-500"
                  value={payers.amounts[m.id] ?? ""}
                  onChange={(e) => {
                    update({
                      payers: {
                        mode: "several",
                        amounts: { ...payers.amounts, [m.id]: e.target.value },
                      },
                    });
                  }}
                />
              </li>
            ))}
          </ul>
          {status.kind !== "needAmount" && status.kind !== "balanced" && (
            <p className="text-sm font-bold text-red-700">
              {status.kind === "amountInvalid"
                ? t("expense.payersInvalid")
                : t(
                    status.kind === "remaining" ? "expense.payersRemaining" : "expense.payersOver",
                    {
                      amount: formatAmount(status.amountMinor, draft.currency),
                    },
                  )}
            </p>
          )}
        </>
      )}
    </fieldset>
  );
}
