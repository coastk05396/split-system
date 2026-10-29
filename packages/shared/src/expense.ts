import { z } from "zod";
import type { CurrencyCode } from "./currency.js";
import { convertAmount, RATE_SCALE } from "./fx.js";
import { convertLines } from "./payers.js";
import { err, ok, type Result } from "./result.js";
import { currencyCodeSchema, type ExpenseInput, localDateSchema } from "./schemas.js";
import { type SplitError, type SplitLine, splitEqual, splitExact, splitShares } from "./split.js";
import { MEMBER_STATUSES } from "./groups.js";

/** Expenses, Balances and Exchange rates (SPEC §3, §5; decisions 08, 11, 15, 16, 23). */

/** Expenses a Group may hold (decision 15). */
export const MAX_EXPENSES_PER_GROUP = 2000;
/** Rows per page of `GET /groups/:id/expenses` (decision 16). */
export const EXPENSE_PAGE_SIZE = 50;

export const SPLIT_METHODS = ["equal", "exact", "shares"] as const;
export type SplitMethod = (typeof SPLIT_METHODS)[number];

const int = z.number().int();

/** An Expense as the API returns it; amounts in both currencies on every line. */
export const expenseSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  creatorMemberId: z.string(),
  description: z.string(),
  category: z.string(),
  originalAmount: int,
  originalCurrency: currencyCodeSchema,
  fxRateScaled: int,
  fxDate: z.string(),
  isCustomRate: z.boolean(),
  settlementAmount: int,
  splitMethod: z.enum(SPLIT_METHODS),
  payers: z.array(z.object({ memberId: z.string(), amountMinor: int, settlementAmount: int })),
  splits: z.array(
    z.object({
      memberId: z.string(),
      shares: int.nullable(),
      amountMinor: int,
      settlementAmount: int,
    }),
  ),
  expenseDate: z.string(),
  expenseTime: z.string().nullable(),
  stopId: z.string().nullable(),
  createdAt: int,
  updatedAt: int,
});
export type Expense = z.infer<typeof expenseSchema>;

/** One page of a Group's Expenses, newest first; `nextCursor` is null on the last page. */
export const expensePageSchema = z.object({
  expenses: z.array(expenseSchema),
  nextCursor: z.string().nullable(),
});
export type ExpensePage = z.infer<typeof expensePageSchema>;

/** `GET /groups/:id/balances`: every Member's Balance, Former Members included. */
export const balancesSchema = z.object({
  settlementCurrency: currencyCodeSchema,
  balances: z.array(
    z.object({
      memberId: z.string(),
      displayName: z.string(),
      status: z.enum(MEMBER_STATUSES),
      balance: int,
    }),
  ),
});
export type Balances = z.infer<typeof balancesSchema>;

/** `GET /rates?date&base&quote`. */
export const rateQuerySchema = z.object({
  date: localDateSchema,
  base: currencyCodeSchema,
  quote: currencyCodeSchema,
});
export type RateQuery = z.infer<typeof rateQuerySchema>;

/**
 * A reference Exchange rate: 1 `base` is `rateScaled / 1,000,000` `quote`, published for
 * `rateDate` (the asked date or the last day before it with a rate). `stale` is true when the
 * sources were down and this is the newest cached rate instead ("使用 {date} 的匯率").
 */
export const rateSchema = z.object({
  base: currencyCodeSchema,
  quote: currencyCodeSchema,
  rateScaled: int,
  rateDate: z.string(),
  stale: z.boolean(),
});
export type Rate = z.infer<typeof rateSchema>;

export type ExpenseAllocationInput = Pick<
  ExpenseInput,
  | "originalAmount"
  | "originalCurrency"
  | "fxRateScaled"
  | "isCustomRate"
  | "settlementAmount"
  | "payers"
  | "split"
>;

export interface AllocatedPayer {
  memberId: string;
  /** In the Expense currency. */
  amountMinor: number;
  /** In the Settlement currency. */
  settlementAmount: number;
}

export interface AllocatedSplit {
  memberId: string;
  /** The Share weight under the shares Split method, else null. */
  shares: number | null;
  /** In the Expense currency. */
  amountMinor: number;
  /** In the Settlement currency. */
  settlementAmount: number;
}

export interface ExpenseAllocation {
  payers: AllocatedPayer[];
  splits: AllocatedSplit[];
}

export type ExpenseAllocationError = SplitError | "RATE_INVALID" | "SETTLEMENT_AMOUNT_MISMATCH";

/**
 * Checks the conversion. A same-currency Expense uses the rate 1,000,000 and the same amount.
 * A reference rate must give the confirmed converted amount; a custom rate (or a typed
 * converted amount, decision 23) leaves the confirmed amount as the authority.
 */
function checkConversion(
  input: ExpenseAllocationInput,
  settlementCurrency: CurrencyCode,
): ExpenseAllocationError | undefined {
  if (input.originalCurrency === settlementCurrency) {
    if (input.fxRateScaled !== RATE_SCALE) return "RATE_INVALID";
    return input.settlementAmount === input.originalAmount
      ? undefined
      : "SETTLEMENT_AMOUNT_MISMATCH";
  }
  if (input.isCustomRate) return undefined;
  const converted = convertAmount(
    input.originalAmount,
    input.originalCurrency,
    settlementCurrency,
    input.fxRateScaled,
  );
  if (!converted.ok) return "RATE_INVALID";
  return converted.value === input.settlementAmount ? undefined : "SETTLEMENT_AMOUNT_MISMATCH";
}

/**
 * Divides an Expense into payer and split lines in both currencies (decision 15 invariant 3):
 * the split runs in the Expense currency with the leftover rule, payers first, then the
 * Group's fixed member order (`memberOrder`); payer and split lines are then each converted to
 * the Settlement currency with the same rule so they sum to `settlementAmount` exactly.
 */
export function allocateExpense(
  input: ExpenseAllocationInput,
  settlementCurrency: CurrencyCode,
  memberOrder: readonly string[],
): Result<ExpenseAllocation, ExpenseAllocationError> {
  const conversion = checkConversion(input, settlementCurrency);
  if (conversion !== undefined) return err(conversion);

  const position = new Map(memberOrder.map((id, index) => [id, index]));
  const rank = (memberId: string): number => position.get(memberId) ?? memberOrder.length;
  const byOrder = <T extends { memberId: string }>(lines: readonly T[]): T[] =>
    [...lines].sort((x, y) => rank(x.memberId) - rank(y.memberId));

  const payerIds = byOrder(input.payers).map((p) => p.memberId);
  const { split } = input;
  let lines: Result<SplitLine[], SplitError>;
  let shares = new Map<string, number>();
  if (split.method === "equal") {
    const participants = byOrder(split.participants.map((memberId) => ({ memberId })));
    lines = splitEqual(
      input.originalAmount,
      participants.map((p) => p.memberId),
      payerIds,
    );
  } else if (split.method === "shares") {
    shares = new Map(split.lines.map((l) => [l.memberId, l.shares]));
    lines = splitShares(input.originalAmount, byOrder(split.lines), payerIds);
  } else {
    lines = splitExact(input.originalAmount, byOrder(split.lines));
  }
  if (!lines.ok) return lines;

  const payers = byOrder(input.payers);
  const convertedPayers = convertLines(payers, input.settlementAmount, payerIds);
  const convertedSplits = convertLines(lines.value, input.settlementAmount, payerIds);
  return ok({
    payers: payers.map((p, i) => ({
      memberId: p.memberId,
      amountMinor: p.amountMinor,
      settlementAmount: convertedPayers[i]?.amountMinor ?? 0,
    })),
    splits: lines.value.map((l, i) => ({
      memberId: l.memberId,
      shares: shares.get(l.memberId) ?? null,
      amountMinor: l.amountMinor,
      settlementAmount: convertedSplits[i]?.amountMinor ?? 0,
    })),
  });
}
