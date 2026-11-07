import { z } from "zod";
import { currencyCodeSchema, localDateSchema } from "./schemas.js";

export const airportCodeSchema = z.string().regex(/^[A-Z]{3}$/);
export const FLIGHT_THEMES = ["warm_island", "food_city", "solo"] as const;
export const flightSearchFields = z.object({
  origin: airportCodeSchema.default("TPE"),
  destination: airportCodeSchema,
  departureDate: localDateSchema,
  returnDate: localDateSchema,
  currency: currencyCodeSchema.default("TWD"),
  budget: z.number().int().positive().max(99_999_999).optional(),
  excludeRedEye: z.boolean().default(false),
  directOnly: z.boolean().default(false),
  theme: z.enum(FLIGHT_THEMES).optional(),
});
export const flightSearchDefaultsSchema = flightSearchFields.partial();
export const flightSearchIntentSchema = flightSearchFields.refine(
  (i) => i.returnDate > i.departureDate,
  { path: ["returnDate"], message: "DATE_INVALID" },
);
export type FlightSearchIntent = z.infer<typeof flightSearchIntentSchema>;
export type DealSignal = "strong_buy" | "buy" | "hold";
export const flightFareSchema = z.object({
  price: z.number().int().positive().max(99_999_999),
  airline: z.string().min(1).max(120),
  outboundDeparture: z.string().min(1).max(40),
  outboundArrival: z.string().min(1).max(40),
  inboundDeparture: z.string().min(1).max(40).nullable(),
  inboundArrival: z.string().min(1).max(40).nullable(),
  stops: z.number().int().min(0).max(8),
  durationMinutes: z.number().int().positive().max(10_080),
  priceLevel: z.enum(["low", "typical", "high", "unknown"]),
});
export type FlightFare = z.infer<typeof flightFareSchema>;
export interface FlightCard extends FlightFare {
  intent: FlightSearchIntent;
  signal: DealSignal;
  history?: import("./flight-signals.js").FareHistoryStats | null;
  overBudget: number;
  url: string;
}
export interface FlightSearchReply {
  intent: FlightSearchIntent;
  cards: FlightCard[];
  degraded: boolean;
  url: string;
}

/** Published fast-flights protobuf fields; URL handoff also works when the source is unavailable. */
export function googleFlightsUrl(
  intent: Pick<
    FlightSearchIntent,
    "origin" | "destination" | "departureDate" | "returnDate" | "currency"
  > &
    Partial<FlightSearchIntent>,
): string {
  const text = (field: number, value: string): number[] => {
    const bytes = [...new TextEncoder().encode(value)];
    return [field * 8 + 2, bytes.length, ...bytes];
  };
  const leg = (date: string, from: string, to: string): number[] => {
    const bytes = [
      ...text(2, date),
      106,
      5,
      ...text(2, from),
      114,
      5,
      ...text(2, to),
      ...(intent.directOnly ? [40, 0] : []),
      ...(intent.excludeRedEye ? [64, 6, 72, 21] : []),
    ];
    return [26, bytes.length, ...bytes];
  };
  const bytes = [
    ...leg(intent.departureDate, intent.origin, intent.destination),
    ...leg(intent.returnDate, intent.destination, intent.origin),
    72,
    1,
    64,
    1,
    152,
    1,
    1,
  ];
  const tfs = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `https://www.google.com/travel/flights/search?tfs=${tfs}&curr=${intent.currency}`;
}

export interface FlightHighlightsReply {
  highlights: FlightCard[];
  recipes?: import("./flight-discovery.js").VibeRecipe[];
}
