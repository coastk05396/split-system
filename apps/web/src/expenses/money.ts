import { CURRENCIES, type CurrencyCode } from "@split/shared";

/** Minor units as the plain decimal text an amount field holds ("12.30"), no symbol or commas. */
export function minorToText(minor: number, currency: CurrencyCode): string {
  const { decimals } = CURRENCIES[currency];
  if (decimals === 0) return String(minor);
  const digits = String(minor).padStart(decimals + 1, "0");
  return `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
}
