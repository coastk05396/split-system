import type { Stop } from "@split/shared";
import { monthDay, weekday } from "../i18n/format.js";

/** Trip dates and Stop days are local calendar dates, "2026-06-13" (no timezone). */

const DAY_MS = 86_400_000;

function utc(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

/** Every day from `start` to `end`, both included. */
export function daysBetween(start: string, end: string): string[] {
  const days: string[] = [];
  for (let at = utc(start).getTime(); at <= utc(end).getTime(); at += DAY_MS) {
    days.push(new Date(at).toISOString().slice(0, 10));
  }
  return days;
}

/** Days in the Trip's number of days, inclusive; NaN when either date is missing. */
export function tripLength(start: string, end: string): number {
  return (utc(end).getTime() - utc(start).getTime()) / DAY_MS + 1;
}

/**
 * The days the itinerary shows: the Trip's dates when both are set, else the days that
 * already hold Stops.
 */
export function planDays(start: string | null, end: string | null, stops: readonly Stop[]) {
  if (start !== null && end !== null && start <= end) return daysBetween(start, end);
  return [...new Set(stops.map((s) => s.dayDate))].sort();
}

/** "6月13日" or "June 13". */
export const dayLabel = monthDay;

/** "週六" or "Sat". */
export const weekdayLabel = weekday;

/** Today on this device as a local calendar date. */
export function localToday(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const date = String(now.getDate()).padStart(2, "0");
  return `${String(now.getFullYear())}-${month}-${date}`;
}

/**
 * A day's Stops by start time; Stops with no time go last in the order added (decision 13).
 * The Worker already answers in this order; sorting again keeps an edit's optimistic view right.
 */
export function sortStops(stops: readonly Stop[]): Stop[] {
  return [...stops].sort((a, b) => {
    if (a.startTime === null || b.startTime === null) {
      if (a.startTime !== b.startTime) return a.startTime === null ? 1 : -1;
    } else if (a.startTime !== b.startTime) {
      return a.startTime < b.startTime ? -1 : 1;
    }
    return a.createdAt - b.createdAt;
  });
}

/** "09:30 – 11:00", "09:30", "– 11:00" or null with no times. */
export function timeRange(stop: Pick<Stop, "startTime" | "endTime">): string | null {
  const { startTime: start, endTime: end } = stop;
  if (start === null && end === null) return null;
  if (end === null) return start;
  return `${start ?? ""} – ${end}`.trim();
}

/** A free Google Maps search link for a typed location (decision 13: no maps API). */
export function mapsUrl(location: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}
