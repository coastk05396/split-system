import { z } from "zod";
import { CURRENCY_CODES, MAX_AMOUNT_MINOR, MIN_AMOUNT_MINOR } from "./currency.js";
import { validatePayers } from "./payers.js";
import { MAX_SHARES, MIN_SHARES, splitExact } from "./split.js";

/**
 * Request shapes the API accepts. The Worker validates every request with these and the SPA
 * reuses them. Rules that need the Group (membership, Settlement currency, conversion) are
 * checked by the Worker. Custom issue messages are the API's stable error codes.
 */

export const MAX_MEMBERS_PER_GROUP = 30;
export const MAX_TRIP_DAYS = 31;
export const MAX_NAME_LENGTH = 50;
export const MAX_DESCRIPTION_LENGTH = 100;
export const MAX_CATEGORY_LENGTH = 32;
export const MAX_NOTES_LENGTH = 500;

export const currencyCodeSchema = z.enum(CURRENCY_CODES);
export const idSchema = z.string().min(1).max(64);
export const amountMinorSchema = z.number().int().min(MIN_AMOUNT_MINOR).max(MAX_AMOUNT_MINOR);
export const rateScaledSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

const isCalendarDate = (text: string): boolean => {
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
};

/** Local calendar date with no timezone, "2026-06-13". */
export const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isCalendarDate, "DATE_INVALID");

/** Local time of day with no timezone, "14:30". */
export const localTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const textSchema = (max: number) => z.string().trim().min(1).max(max);

const splitLineSchema = z.object({
  memberId: idSchema,
  amountMinor: z.number().int().min(0).max(MAX_AMOUNT_MINOR),
});

export const splitInputSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("equal"),
    participants: z.array(idSchema).min(1).max(MAX_MEMBERS_PER_GROUP),
  }),
  z.object({
    method: z.literal("exact"),
    lines: z.array(splitLineSchema).min(1).max(MAX_MEMBERS_PER_GROUP),
  }),
  z.object({
    method: z.literal("shares"),
    lines: z
      .array(
        z.object({ memberId: idSchema, shares: z.number().int().min(MIN_SHARES).max(MAX_SHARES) }),
      )
      .min(1)
      .max(MAX_MEMBERS_PER_GROUP),
  }),
]);

const splitMemberIds = (split: z.infer<typeof splitInputSchema>): string[] =>
  split.method === "equal" ? split.participants : split.lines.map((l) => l.memberId);

export const expenseInputSchema = z
  .object({
    description: textSchema(MAX_DESCRIPTION_LENGTH),
    category: textSchema(MAX_CATEGORY_LENGTH),
    originalAmount: amountMinorSchema,
    originalCurrency: currencyCodeSchema,
    fxRateScaled: rateScaledSchema,
    fxDate: localDateSchema,
    isCustomRate: z.boolean(),
    /** Converted amount in the Group's Settlement currency, as the user confirmed it. */
    settlementAmount: amountMinorSchema,
    payers: z
      .array(z.object({ memberId: idSchema, amountMinor: amountMinorSchema }))
      .min(1)
      .max(MAX_MEMBERS_PER_GROUP),
    split: splitInputSchema,
    expenseDate: localDateSchema,
    expenseTime: localTimeSchema.nullable().optional(),
    stopId: idSchema.nullable().optional(),
  })
  .superRefine((expense, ctx) => {
    const payers = validatePayers(expense.originalAmount, expense.payers);
    if (!payers.ok) ctx.addIssue({ code: "custom", message: payers.error, path: ["payers"] });

    const ids = splitMemberIds(expense.split);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", message: "SPLIT_DUPLICATE_MEMBER", path: ["split"] });
    } else if (expense.split.method === "exact") {
      const exact = splitExact(expense.originalAmount, expense.split.lines);
      if (!exact.ok) ctx.addIssue({ code: "custom", message: exact.error, path: ["split"] });
    }
  });

export type ExpenseInput = z.infer<typeof expenseInputSchema>;

export const settlementInputSchema = z
  .object({
    payerMemberId: idSchema,
    receiverMemberId: idSchema,
    amount: amountMinorSchema,
  })
  .refine((s) => s.payerMemberId !== s.receiverMemberId, {
    message: "SETTLEMENT_SAME_MEMBER",
    path: ["receiverMemberId"],
  });

export type SettlementInput = z.infer<typeof settlementInputSchema>;

const daysBetween = (start: string, end: string): number =>
  (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;

export const groupInputSchema = z
  .object({
    name: textSchema(MAX_NAME_LENGTH),
    settlementCurrency: currencyCodeSchema.default("TWD"),
    isTrip: z.boolean().default(false),
    tripDestination: textSchema(MAX_NAME_LENGTH).optional(),
    tripStartDate: localDateSchema.optional(),
    tripEndDate: localDateSchema.optional(),
    tripNotes: z.string().max(MAX_NOTES_LENGTH).optional(),
  })
  .superRefine((group, ctx) => {
    const { tripStartDate: start, tripEndDate: end } = group;
    if (start === undefined || end === undefined) return;
    const days = daysBetween(start, end) + 1;
    if (days < 1 || days > MAX_TRIP_DAYS) {
      ctx.addIssue({ code: "custom", message: "TRIP_DATES_INVALID", path: ["tripEndDate"] });
    }
  });

export type GroupInput = z.infer<typeof groupInputSchema>;

export const stopInputSchema = z
  .object({
    dayDate: localDateSchema,
    startTime: localTimeSchema.optional(),
    endTime: localTimeSchema.optional(),
    title: textSchema(MAX_NAME_LENGTH),
    category: textSchema(MAX_CATEGORY_LENGTH),
    locationName: z.string().trim().max(MAX_DESCRIPTION_LENGTH).optional(),
    notes: z.string().max(MAX_NOTES_LENGTH).optional(),
  })
  .refine((s) => s.startTime === undefined || s.endTime === undefined || s.startTime <= s.endTime, {
    message: "STOP_TIME_INVALID",
    path: ["endTime"],
  });

export type StopInput = z.infer<typeof stopInputSchema>;
