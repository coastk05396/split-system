import { err, ok, type Result } from "./result.js";

/** Currencies shipped in v1. Each amount is an integer in the currency's smallest unit. */
export const CURRENCIES = {
  TWD: { decimals: 0, symbol: "NT$" },
  USD: { decimals: 2, symbol: "US$" },
} as const satisfies Record<string, { decimals: number; symbol: string }>;

export type CurrencyCode = keyof typeof CURRENCIES;
export const CURRENCY_CODES = Object.keys(CURRENCIES) as [CurrencyCode, ...CurrencyCode[]];

/** An Expense is 1 to 99,999,999 units of its currency (NT$ 99,999,999 or US$ 999,999.99). */
export const MIN_AMOUNT_MINOR = 1;
export const MAX_AMOUNT_MINOR = 99_999_999;

export function isValidExpenseAmount(minor: number): boolean {
  return Number.isInteger(minor) && minor >= MIN_AMOUNT_MINOR && minor <= MAX_AMOUNT_MINOR;
}

/** Reads plain decimal text ("12.34") into minor units; no signs, separators or exponents. */
export function parseAmount(
  text: string,
  currency: CurrencyCode,
): Result<number, "AMOUNT_INVALID"> {
  const { decimals } = CURRENCIES[currency];
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return err("AMOUNT_INVALID");
  const whole = match[1] ?? "";
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) return err("AMOUNT_INVALID");
  const value = Number(whole + fraction.padEnd(decimals, "0"));
  if (!Number.isSafeInteger(value)) return err("AMOUNT_INVALID");
  return ok(value);
}

/** Shows an amount as "NT$ 2,160" or "US$ 12.34"; a negative Balance becomes "-NT$ 293". */
export function formatAmount(minor: number, currency: CurrencyCode): string {
  const { decimals, symbol } = CURRENCIES[currency];
  const sign = minor < 0 ? "-" : "";
  const digits = Math.abs(minor)
    .toString()
    .padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${symbol} ${grouped}${decimals > 0 ? `.${fraction}` : ""}`;
}

/** Minor units as plain decimal text ("12.34" or "-12.34"), without currency symbol or grouping commas. */
export function minorToDecimal(minor: number, currency: CurrencyCode): string {
  const { decimals } = CURRENCIES[currency];
  if (decimals === 0) return String(minor);
  const digits = String(Math.abs(minor)).padStart(decimals + 1, "0");
  const sign = minor < 0 ? "-" : "";
  return `${sign}${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
}
