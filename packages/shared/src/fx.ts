import { CURRENCIES, isValidExpenseAmount, type CurrencyCode } from "./currency.js";
import { err, ok, type Result } from "./result.js";

/** An Exchange rate is stored as an integer scaled by 1,000,000 (31.5234 is 31523400). */
export const RATE_SCALE = 1_000_000;
const RATE_DECIMALS = 6;
const DISPLAY_DECIMALS = 4;

export type FxError = "RATE_INVALID" | "EXPENSE_AMOUNT_INVALID";

const pow10 = (n: number): bigint => 10n ** BigInt(n);

/** Rounds a positive fraction num/den to the nearest integer, a half going up. */
const roundHalfUp = (num: bigint, den: bigint): bigint => (2n * num + den) / (2n * den);

const isValidRate = (rateScaled: number): boolean =>
  Number.isSafeInteger(rateScaled) && rateScaled > 0;

/**
 * Converts an Expense amount into the Settlement currency. `rateScaled` means
 * "1 unit of `from` is rateScaled / 1,000,000 units of `to`" in major units. The result is
 * rounded to the target currency's smallest unit and must itself be a valid Expense amount.
 */
export function convertAmount(
  amountMinor: number,
  from: CurrencyCode,
  to: CurrencyCode,
  rateScaled: number,
): Result<number, FxError> {
  if (!isValidExpenseAmount(amountMinor)) return err("EXPENSE_AMOUNT_INVALID");
  if (!isValidRate(rateScaled)) return err("RATE_INVALID");
  if (from === to) return rateScaled === RATE_SCALE ? ok(amountMinor) : err("RATE_INVALID");
  const num = BigInt(amountMinor) * BigInt(rateScaled) * pow10(CURRENCIES[to].decimals);
  const den = BigInt(RATE_SCALE) * pow10(CURRENCIES[from].decimals);
  const converted = Number(roundHalfUp(num, den));
  return isValidExpenseAmount(converted) ? ok(converted) : err("EXPENSE_AMOUNT_INVALID");
}

/**
 * Converts a Balance of any size and either sign, for a total shown on screen. Unlike an
 * Expense (`convertAmount`) it has no 99,999,999 cap; it fails only on an unusable rate or a
 * result too large to hold exactly. The result is rounded to the target's smallest unit.
 */
export function convertBalance(
  amountMinor: number,
  from: CurrencyCode,
  to: CurrencyCode,
  rateScaled: number,
): Result<number, "RATE_INVALID" | "AMOUNT_INVALID"> {
  if (!Number.isSafeInteger(amountMinor)) return err("AMOUNT_INVALID");
  if (from === to) return ok(amountMinor);
  if (!isValidRate(rateScaled)) return err("RATE_INVALID");
  const num = BigInt(Math.abs(amountMinor)) * BigInt(rateScaled) * pow10(CURRENCIES[to].decimals);
  const den = BigInt(RATE_SCALE) * pow10(CURRENCIES[from].decimals);
  const magnitude = Number(roundHalfUp(num, den));
  if (!Number.isSafeInteger(magnitude)) return err("AMOUNT_INVALID");
  return ok(amountMinor < 0 ? -magnitude : magnitude);
}

/**
 * Derives the scaled rate from a converted amount the user typed. The typed amount stays the
 * authority; this rate is stored for display with the custom-rate flag set.
 */
export function deriveRateScaled(
  amountMinor: number,
  from: CurrencyCode,
  convertedMinor: number,
  to: CurrencyCode,
): Result<number, FxError> {
  if (!isValidExpenseAmount(amountMinor) || !isValidExpenseAmount(convertedMinor)) {
    return err("EXPENSE_AMOUNT_INVALID");
  }
  const num = BigInt(convertedMinor) * pow10(CURRENCIES[from].decimals) * BigInt(RATE_SCALE);
  const den = BigInt(amountMinor) * pow10(CURRENCIES[to].decimals);
  const rate = Number(roundHalfUp(num, den));
  return isValidRate(rate) ? ok(rate) : err("RATE_INVALID");
}

/**
 * Shows a scaled rate to four decimals, as in "1 USD ≈ NT$ 31.5234". Below 1 the leading
 * digits are zeros (1 JPY ≈ 0.006543 USD), so it shows up to six, dropping zeros past the fourth.
 */
export function formatRate(rateScaled: number): string {
  if (rateScaled < RATE_SCALE) {
    const fraction = String(rateScaled).padStart(RATE_DECIMALS, "0");
    let end = RATE_DECIMALS;
    while (end > DISPLAY_DECIMALS && fraction[end - 1] === "0") end--;
    return `0.${fraction.slice(0, end)}`;
  }
  const units = roundHalfUp(BigInt(rateScaled), pow10(RATE_DECIMALS - DISPLAY_DECIMALS));
  const digits = units.toString().padStart(DISPLAY_DECIMALS + 1, "0");
  return `${digits.slice(0, -DISPLAY_DECIMALS)}.${digits.slice(-DISPLAY_DECIMALS)}`;
}

/** Reads a typed custom rate (up to six decimals, above zero) into the scaled integer. */
export function parseRate(text: string): Result<number, "RATE_INVALID"> {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(text);
  if (!match) return err("RATE_INVALID");
  const rate = Number((match[1] ?? "") + (match[2] ?? "").padEnd(RATE_DECIMALS, "0"));
  return isValidRate(rate) ? ok(rate) : err("RATE_INVALID");
}
