import { getLocale } from "../i18n/messages.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = "日一二三四五六";

/** Calendar parts of an ISO date; no time zone is involved, so the date never shifts. */
function parts(date: string) {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  return { month, day, weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay() };
}

/** "12/4" in Traditional Chinese, "Dec 4" in English. */
export function shortDate(date: string): string {
  const { month, day } = parts(date);
  return getLocale() === "en"
    ? `${MONTHS[month - 1] ?? ""} ${String(day)}`
    : `${String(month)}/${String(day)}`;
}

/** "12/4（五）" in Traditional Chinese, "Dec 4" in English. */
export function friendlyDate(date: string): string {
  return getLocale() === "en"
    ? shortDate(date)
    : `${shortDate(date)}（${WEEKDAYS[parts(date).weekday] ?? ""}）`;
}

/** "12/4（五）– 12/7（一）", or "Dec 4 – Dec 7"; the one date alone for a one-way search. */
export function friendlyRange(from: string, to?: string): string {
  if (to === undefined) return friendlyDate(from);
  // Chinese text spaces the dash only on its right, as the full-width parenthesis already pads its left.
  return `${friendlyDate(from)}${getLocale() === "en" ? " " : ""}– ${friendlyDate(to)}`;
}

/** "1/8–1/11" in both languages: the compact range for chips that must fit about 200 px. */
export function shortRange(from: string, to?: string): string {
  const numeric = (date: string) => `${String(parts(date).month)}/${String(parts(date).day)}`;
  return to === undefined ? numeric(from) : `${numeric(from)}–${numeric(to)}`;
}
