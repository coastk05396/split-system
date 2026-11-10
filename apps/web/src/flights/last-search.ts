import { flightSearchIntentSchema, type FlightSearchIntent } from "@split/shared";

const KEY = "split.flightLastSearch";

/** The intent this browser searched last, or null; it holds search conditions only. */
export function readLastSearch(): FlightSearchIntent | null {
  try {
    const parsed = flightSearchIntentSchema.safeParse(
      JSON.parse(localStorage.getItem(KEY) ?? "null"),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeLastSearch(intent: FlightSearchIntent): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(intent));
  } catch {
    // Storage can be blocked; restoring the last search is a convenience only.
  }
}
