import { DELETED_USER_NAME, REMOVED_PLACEHOLDER_NAME } from "@split/shared";
import { getLocale, t } from "./messages.js";

/** Every date in the app is drawn by this locale: 2026年10月29日, or October 29, 2026. */
const dateLocale = () => (getLocale() === "en" ? "en" : "zh-TW");

function utc(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

/** "2026年10月29日" or "October 29, 2026", for a "2026-10-29" calendar date. */
export function longDate(day: string): string {
  return utc(day).toLocaleDateString(dateLocale(), {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "6月13日" or "June 13". */
export function monthDay(day: string): string {
  return utc(day).toLocaleDateString(dateLocale(), {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "週六" or "Sat". */
export function weekday(day: string): string {
  return utc(day).toLocaleDateString(dateLocale(), { weekday: "short", timeZone: "UTC" });
}

/** A date from a timestamp, in the viewer's own timezone. */
export function dateFromTimestamp(ms: number): string {
  return new Date(ms).toLocaleDateString(dateLocale());
}

/** The labels the server stores for people who are gone, shown in the app's language. */
export function localName(name: string): string {
  if (name === DELETED_USER_NAME) return t("marker.deletedUser");
  if (name === REMOVED_PLACEHOLDER_NAME) return t("marker.removedMember");
  return name;
}

/** The weekday as a chip label: "六" or "Sat". */
export function weekdayShort(day: string): string {
  const full = weekday(day);
  return getLocale() === "en" ? full : full.replace(/^週/, "");
}
