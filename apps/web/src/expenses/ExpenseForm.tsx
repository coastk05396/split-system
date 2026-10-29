import * as Menu from "@radix-ui/react-dropdown-menu";
import * as Tabs from "@radix-ui/react-tabs";
import {
  CURRENCY_CODES,
  type CurrencyCode,
  type Expense,
  formatAmount,
  formatRate,
  type Group,
  type Member,
} from "@split/shared";
import { ArrowRight, ChevronDown, Users } from "lucide-react";
import { type SubmitEvent, useRef, useState } from "react";
import { ApiFailure } from "../api/errors.js";
import { card, failureMessage, input, primaryButton } from "../groups/ui.js";
import { errorMessage, t } from "../i18n/messages.js";
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
  onSaved,
}: {
  group: Group;
  members: readonly Member[];
  /** The Expense being edited; a new one when absent. */
  expense?: Expense;
  onSaved: (expense: Expense) => void;
}) {
  const selectable: SplitMember[] = members
    .filter((m) => m.status !== "former")
    .map((m) => ({
      id: m.id,
      displayName: m.displayName,
      placeholder: m.status === "placeholder",
    }));
  const order = selectable.map((m) => m.id);
  const [draft, setDraft] = useState<ExpenseDraft>(() =>
    expense === undefined
      ? newExpenseDraft({
          currency: group.defaultExpenseCurrency,
          myMemberId: group.me.memberId,
          memberIds: order,
          now: new Date(),
        })
      : expenseDraftFrom(expense, group.settlementCurrency),
  );
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
    if (body === null || save.isPending) return;
    save.mutate(
      expense === undefined
        ? { kind: "create", input: body, idempotencyKey: idempotencyKey.current }
        : { kind: "edit", input: body, expense },
      { onSuccess: onSaved },
    );
  };

  return (
    <Tabs.Root defaultValue="spend" className="flex flex-col gap-6">
      <Tabs.List
        aria-label={t("expense.kind")}
        className="flex gap-1 rounded-2xl bg-sprout-150 p-1"
      >
        {(["spend", "transfer"] as const).map((kind) => (
          <Tabs.Trigger
            key={kind}
            value={kind}
            className="flex-1 rounded-xl py-2.5 text-ink-muted data-[state=active]:bg-white data-[state=active]:font-bold data-[state=active]:text-ink"
          >
            {t(kind === "spend" ? "expense.tab.spend" : "expense.tab.transfer")}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      <Tabs.Content value="transfer">
        {/* TODO(ticket 12): link to the record-Settlement screen once the Settlements API lands. */}
        <p className={`${card} p-5 text-ink-muted`}>{t("expense.transferStub")}</p>
      </Tabs.Content>
      <Tabs.Content value="spend">
        <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
          <AmountSection
            draft={draft}
            evaluation={evaluation}
            settlementCurrency={group.settlementCurrency}
            rate={{
              loading: rate.isFetching,
              unavailable: rate.isError,
              date: rate.data?.rateDate,
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
                  className="cursor-pointer rounded-full border border-sprout-200 bg-white px-4 py-1.5 has-[:checked]:border-sprout-500 has-[:checked]:bg-sprout-100 has-[:checked]:font-bold"
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
                  {category}
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
          {group.isTrip && (
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
          <button
            type="submit"
            className={`${primaryButton} justify-between`}
            disabled={evaluation.input === null || save.isPending}
          >
            {save.isPending
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
  rate: { loading: boolean; unavailable: boolean; date: string | undefined };
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
          {t("expense.result", { amount: formatAmount(amount.amountMinor, draft.currency) })}
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
          className="z-20 min-w-40 rounded-2xl border border-sprout-200 bg-white p-1 shadow-lg"
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
  rate: { loading: boolean; unavailable: boolean; date: string | undefined };
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
      <p className="text-xs text-ink-muted">
        {draft.conversion.source !== "reference"
          ? t("expense.rateCustom")
          : rate.loading
            ? t("expense.rateLoading")
            : rate.unavailable
              ? errorMessage("RATE_UNAVAILABLE")
              : conversion.kind === "ok"
                ? t("expense.rateHint", {
                    base: draft.currency,
                    quote: settlementCurrency,
                    rate: formatRate(conversion.rateScaled),
                    date: rate.date ?? draft.date,
                  })
                : ""}
      </p>
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
        <div className="flex flex-wrap gap-2">
          {members.map((m) => (
            <label
              key={m.id}
              className="cursor-pointer rounded-full border border-sprout-200 bg-white px-4 py-1.5 has-[:checked]:border-sprout-500 has-[:checked]:bg-sprout-100 has-[:checked]:font-bold"
            >
              <input
                type="radio"
                name="payer"
                aria-label={t("expense.paidBy", { name: m.displayName })}
                className="sr-only"
                checked={payers.memberId === m.id}
                onChange={() => {
                  update({ payers: { mode: "single", memberId: m.id } });
                }}
              />
              {m.displayName}
            </label>
          ))}
        </div>
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
