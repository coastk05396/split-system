import { z } from "zod";
import { FLIGHT_DESTINATIONS } from "./flight-catalog.js";
import {
  flightSearchDefaultsSchema,
  flightSearchIntentSchema,
  type FlightSearchIntent,
} from "./flights.js";
import { formatAmount, type CurrencyCode } from "./currency.js";

export const flightPromptRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(1000),
  defaults: flightSearchDefaultsSchema.optional(),
});
export const flightSearchRequestSchema = z.union([
  flightSearchIntentSchema,
  flightPromptRequestSchema,
]);
export type FlightSearchRequest = z.infer<typeof flightSearchRequestSchema>;
export type FlightSearchDefaults = z.infer<typeof flightSearchDefaultsSchema>;
export type FlightTiming = "next_weekend" | "next_month_weekend";
const DAY = 86_400_000;
const day = (time: number) => new Date(time).toISOString().slice(0, 10);

/** Taiwan's calendar date (UTC+8) at `now`, as YYYY-MM-DD. */
export const taiwanDate = (now: number) => day(now + 8 * 3_600_000);

/** Calendar decisions use Taiwan's date, independent of either provider's interpretation. */
export function anchorFlightDates(
  timing: FlightTiming,
  durationDays: 3 | 4,
  now: number,
): Pick<FlightSearchIntent, "departureDate" | "returnDate"> {
  const date = new Date(day(now + 8 * 3_600_000));
  if (timing === "next_month_weekend") date.setUTCMonth(date.getUTCMonth() + 1, 1);
  date.setUTCDate(date.getUTCDate() + ((5 - date.getUTCDay() + 7) % 7));
  return {
    departureDate: day(date.getTime()),
    returnDate: day(date.getTime() + (durationDays - 1) * DAY),
  };
}

export function defaultFlightIntent(now: number, currency: CurrencyCode): FlightSearchIntent {
  return {
    origin: "TPE",
    destination: "OKA",
    ...anchorFlightDates("next_month_weekend", 4, now),
    currency,
    excludeRedEye: false,
    directOnly: false,
  };
}

/** Explicit destinations retain a route; a theme selects concrete catalog candidates. */
export function flightCandidates(intent: FlightSearchIntent): FlightSearchIntent[] {
  if (intent.theme) {
    const matches = FLIGHT_DESTINATIONS.filter((destination) => {
      if (intent.theme === "warm_island")
        return (
          destination.climate === "warm" && destination.vibes.some((vibe) => vibe === "island")
        );
      if (intent.theme === "food_city")
        return (
          destination.vibes.some((vibe) => vibe === "food") &&
          destination.vibes.some((vibe) => vibe === "city")
        );
      return destination.vibes.some((vibe) => vibe === "solo");
    });
    const { theme: _theme, ...route } = intent;
    return matches
      .filter((destination) => destination.airport !== intent.origin)
      .slice(0, 4)
      .map((destination) => ({ ...route, destination: destination.airport }));
  }
  return [0, -1, 1].map((shift) => ({
    ...intent,
    departureDate: day(Date.parse(intent.departureDate) + shift * DAY),
    returnDate: day(Date.parse(intent.returnDate) + shift * DAY),
  }));
}

export interface VibeRecipe {
  id: string;
  en: string;
  zhTW: string;
  patch: Partial<FlightSearchIntent>;
}
export function flightRecipes(now: number, currency: CurrencyCode): VibeRecipe[] {
  const date = new Date(now + 8 * 3_600_000);
  const year = date.getUTCFullYear();
  const holiday = [year, year + 1]
    .flatMap((y) => ["01-01", "02-28", "04-04", "05-01", "10-10"].map((md) => `${y}-${md}`))
    .find((value) => value > day(now + 8 * 3_600_000));
  const month = date.getUTCMonth() + 1;
  const budget = { TWD: 15000, USD: 50000, JPY: 50000, THB: 1500000 }[currency];
  return [
    {
      id: "season",
      en: month >= 10 || month <= 3 ? "Winter island escape" : "Summer breather",
      zhTW: month >= 10 || month <= 3 ? "冬日暖島" : "夏日散心",
      patch: { theme: month >= 10 || month <= 3 ? "warm_island" : "solo" },
    },
    { id: "island", en: "Warm island", zhTW: "溫暖海島", patch: { theme: "warm_island" } },
    { id: "food", en: "Food city", zhTW: "美食城市", patch: { theme: "food_city" } },
    { id: "solo", en: "Solo breather", zhTW: "一個人散心", patch: { theme: "solo" } },
    {
      id: "weekend",
      en: "Next weekend",
      zhTW: "下個週末",
      patch: anchorFlightDates("next_weekend", 3, now),
    },
    {
      id: "month",
      en: "Next month's weekend",
      zhTW: "下個月週末",
      patch: anchorFlightDates("next_month_weekend", 4, now),
    },
    ...(holiday
      ? [
          {
            id: "holiday",
            en: `Taiwan holiday bridge ${holiday}`,
            zhTW: `台灣假期接力 ${holiday}`,
            patch: {
              departureDate: day(Date.parse(holiday) - DAY),
              returnDate: day(Date.parse(holiday) + 2 * DAY),
            },
          },
        ]
      : []),
    {
      id: "budget",
      en: `Under ${formatAmount(budget, currency)}`,
      zhTW: `${formatAmount(budget, currency)}以內`,
      patch: { budget },
    },
    {
      id: "red-eye",
      en: "No red-eye flights",
      zhTW: "不要紅眼航班",
      patch: { excludeRedEye: true },
    },
  ];
}
