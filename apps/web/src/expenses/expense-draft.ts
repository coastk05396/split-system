import {
  type CalculatorError,
  convertAmount,
  type CurrencyCode,
  deriveRateScaled,
  evaluateAmount,
  formatRate,
  type Expense,
  type ExpenseInput,
  parseAmount,
  parseRate,
  RATE_SCALE,
  type Rate,
  type SplitLine,
} from "@split/shared";
import { minorToText } from "./money.js";
import {
  evaluateSplit,
  newSplitDraft,
  type SplitDraft,
  splitDraftFrom,
  type SplitEvaluation,
} from "./split-draft.js";

/** Everything the add/edit Expense form holds (decision 23, screen 4 as amended). */
export interface ExpenseDraft {
  description: string;
  category: string;
  currency: CurrencyCode;
  /** What was typed in the amount field: a number or simple arithmetic ("120+80"). */
  amountText: string;
  /**
   * Where the conversion comes from: the reference rate, a typed rate, or a typed converted
   * amount (the authority, the rate then derived from it).
   */
  conversion:
    | { source: "reference" }
    | { source: "rate"; text: string }
    | { source: "converted"; text: string };
  date: string;
  /** "HH:mm", or empty for no time. */
  time: string;
  stopId: string | null;
  payers:
    | { mode: "single"; memberId: string }
    | { mode: "several"; amounts: Readonly<Record<string, string>> };
  split: SplitDraft;
}

export const CATEGORIES = ["餐飲", "交通", "住宿", "購物", "娛樂", "其他"] as const;
const DEFAULT_CATEGORY = "其他";

const pad = (n: number) => String(n).padStart(2, "0");

/** The device's local date and time: the defaults decision 23 asks for. */
export function localNow(now: Date): { date: string; time: string } {
  return {
    date: `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  };
}

export function newExpenseDraft(options: {
  currency: CurrencyCode;
  myMemberId: string;
  memberIds: readonly string[];
  now: Date;
}): ExpenseDraft {
  const { date, time } = localNow(options.now);
  return {
    description: "",
    category: DEFAULT_CATEGORY,
    currency: options.currency,
    amountText: "",
    conversion: { source: "reference" },
    date,
    time,
    stopId: null,
    payers: { mode: "single", memberId: options.myMemberId },
    split: newSplitDraft(options.memberIds),
  };
}

/** A draft holding a saved Expense, for editing. */
export function expenseDraftFrom(expense: Expense, settlementCurrency: CurrencyCode): ExpenseDraft {
  const currency = expense.originalCurrency;
  const [onlyPayer] = expense.payers;
  return {
    description: expense.description,
    category: expense.category,
    currency,
    amountText: minorToText(expense.originalAmount, currency),
    conversion: expense.isCustomRate
      ? { source: "converted", text: minorToText(expense.settlementAmount, settlementCurrency) }
      : { source: "reference" },
    date: expense.expenseDate,
    time: expense.expenseTime ?? "",
    stopId: expense.stopId,
    payers:
      expense.payers.length === 1 && onlyPayer !== undefined
        ? { mode: "single", memberId: onlyPayer.memberId }
        : {
            mode: "several",
            amounts: Object.fromEntries(
              expense.payers.map((p) => [p.memberId, minorToText(p.amountMinor, currency)]),
            ),
          },
    split: splitDraftFrom(expense.splitMethod, expense.splits, currency),
  };
}

/** Normalises what people type on phones: × ÷ − and full-width digits, spaces and commas. */
export function normaliseExpression(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\s,]/g, "")
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/[−–]/g, "-");
}

export type AmountState =
  | { kind: "empty" }
  | { kind: "error"; error: CalculatorError }
  | { kind: "ok"; amountMinor: number; isExpression: boolean };

export function evaluateAmountText(text: string, currency: CurrencyCode): AmountState {
  const expression = normaliseExpression(text);
  if (expression === "") return { kind: "empty" };
  const result = evaluateAmount(expression, currency);
  if (!result.ok) return { kind: "error", error: result.error };
  return { kind: "ok", amountMinor: result.value, isExpression: /[+\-*/()]/.test(expression) };
}

export type ConversionState =
  | { kind: "same" }
  | { kind: "waiting" }
  | { kind: "invalid"; rateText: string; convertedText: string }
  | {
      kind: "ok";
      rateScaled: number;
      settlementAmount: number;
      isCustomRate: boolean;
      fxDate: string;
      rateText: string;
      convertedText: string;
    };

/**
 * The Settlement-currency side of a foreign-currency Expense: a reference rate converts the
 * amount; a typed rate does too (custom); a typed converted amount is kept and the rate derived.
 */
export function evaluateConversion(
  draft: ExpenseDraft,
  amountMinor: number | null,
  settlementCurrency: CurrencyCode,
  reference: Rate | undefined,
): ConversionState {
  if (draft.currency === settlementCurrency) return { kind: "same" };
  const { conversion } = draft;
  const converting = (rateScaled: number, rateText: string, custom: boolean, fxDate: string) => {
    const converted =
      amountMinor === null
        ? null
        : convertAmount(amountMinor, draft.currency, settlementCurrency, rateScaled);
    if (converted === null || !converted.ok) {
      return { kind: "invalid" as const, rateText, convertedText: "" };
    }
    return {
      kind: "ok" as const,
      rateScaled,
      settlementAmount: converted.value,
      isCustomRate: custom,
      fxDate,
      rateText,
      convertedText: minorToText(converted.value, settlementCurrency),
    };
  };

  if (conversion.source === "rate") {
    const rate = parseRate(conversion.text);
    if (!rate.ok) return { kind: "invalid", rateText: conversion.text, convertedText: "" };
    return converting(rate.value, conversion.text, true, draft.date);
  }

  if (conversion.source === "reference") {
    if (reference === undefined) return { kind: "waiting" };
    return converting(
      reference.rateScaled,
      formatRate(reference.rateScaled),
      false,
      reference.rateDate,
    );
  }

  // A typed converted amount is the authority; the rate is derived from it.
  const typed = parseAmount(conversion.text, settlementCurrency);
  const rate =
    amountMinor === null || !typed.ok
      ? null
      : deriveRateScaled(amountMinor, draft.currency, typed.value, settlementCurrency);
  if (rate === null || !rate.ok || !typed.ok) {
    return { kind: "invalid", rateText: "", convertedText: conversion.text };
  }
  return {
    kind: "ok",
    rateScaled: rate.value,
    settlementAmount: typed.value,
    isCustomRate: true,
    fxDate: draft.date,
    rateText: formatRate(rate.value),
    convertedText: conversion.text,
  };
}

export type PayerStatus =
  | { kind: "needAmount" }
  | { kind: "amountInvalid" }
  | { kind: "remaining"; amountMinor: number }
  | { kind: "over"; amountMinor: number }
  | { kind: "balanced"; lines: SplitLine[] };

/** Who paid, as payer lines in the Expense currency; several payers must add up to the total. */
export function evaluatePayers(
  draft: ExpenseDraft,
  amountMinor: number | null,
  memberOrder: readonly string[],
): PayerStatus {
  const { payers } = draft;
  if (amountMinor === null) return { kind: "needAmount" };
  if (payers.mode === "single") {
    return { kind: "balanced", lines: [{ memberId: payers.memberId, amountMinor }] };
  }
  const lines: SplitLine[] = [];
  for (const memberId of memberOrder) {
    const text = payers.amounts[memberId] ?? "";
    if (text === "") continue;
    const parsed = parseAmount(text, draft.currency);
    if (!parsed.ok) return { kind: "amountInvalid" };
    if (parsed.value > 0) lines.push({ memberId, amountMinor: parsed.value });
  }
  const sum = lines.reduce((s, l) => s + l.amountMinor, 0);
  if (sum < amountMinor) return { kind: "remaining", amountMinor: amountMinor - sum };
  if (sum > amountMinor) return { kind: "over", amountMinor: sum - amountMinor };
  return { kind: "balanced", lines };
}

export interface DraftEvaluation {
  amount: AmountState;
  conversion: ConversionState;
  payers: PayerStatus;
  split: SplitEvaluation;
  /** The request body, only when every part of the form is complete and balances. */
  input: ExpenseInput | null;
}

export function evaluateDraft(
  draft: ExpenseDraft,
  context: {
    settlementCurrency: CurrencyCode;
    memberOrder: readonly string[];
    reference: Rate | undefined;
  },
): DraftEvaluation {
  const amount = evaluateAmountText(draft.amountText, draft.currency);
  const amountMinor = amount.kind === "ok" ? amount.amountMinor : null;
  const conversion = evaluateConversion(
    draft,
    amountMinor,
    context.settlementCurrency,
    context.reference,
  );
  const payers = evaluatePayers(draft, amountMinor, context.memberOrder);
  const payerIds = payers.kind === "balanced" ? payers.lines.map((l) => l.memberId) : [];
  const split = evaluateSplit(
    draft.split,
    amountMinor,
    draft.currency,
    context.memberOrder,
    payerIds,
  );

  const description = draft.description.trim();
  const evaluation = { amount, conversion, payers, split, input: null };
  if (amountMinor === null || description === "" || payers.kind !== "balanced") return evaluation;
  if (split.input === null || conversion.kind === "waiting" || conversion.kind === "invalid") {
    return evaluation;
  }

  const fx =
    conversion.kind === "ok"
      ? conversion
      : {
          rateScaled: RATE_SCALE,
          settlementAmount: amountMinor,
          isCustomRate: false,
          fxDate: draft.date,
        };
  return {
    ...evaluation,
    input: {
      description,
      category: draft.category,
      originalAmount: amountMinor,
      originalCurrency: draft.currency,
      fxRateScaled: fx.rateScaled,
      fxDate: fx.fxDate,
      isCustomRate: fx.isCustomRate,
      settlementAmount: fx.settlementAmount,
      payers: payers.lines,
      split: split.input,
      expenseDate: draft.date,
      expenseTime: draft.time === "" ? null : draft.time,
      stopId: draft.stopId,
    },
  };
}
