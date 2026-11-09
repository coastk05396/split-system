import { z } from "zod";
import { currencyCodeSchema, localDateSchema } from "./schemas.js";

export const airportCodeSchema = z.string().regex(/^[A-Z]{3}$/);
export const FLIGHT_THEMES = ["warm_island", "food_city", "solo"] as const;
export const FLIGHT_CABINS = ["economy", "premium-economy", "business", "first"] as const;
export type FlightCabin = (typeof FLIGHT_CABINS)[number];
export const flightSearchFields = z.object({
  origin: airportCodeSchema.default("TPE"),
  destination: airportCodeSchema,
  departureDate: localDateSchema,
  /** Absent for a one-way search. */
  returnDate: localDateSchema.optional(),
  /** Absent means round trip. */
  tripType: z.enum(["round-trip", "one-way"]).optional(),
  /** The party, priced as a whole by the source. Absent means 1 adult, 0 children, 0 infants, economy. */
  adults: z.number().int().min(1).max(9).optional(),
  children: z.number().int().min(0).max(8).optional(),
  /** Lap infants: only the Google link carries them, the shown fare never includes them. */
  infants: z.number().int().min(0).max(4).optional(),
  cabin: z.enum(FLIGHT_CABINS).optional(),
  currency: currencyCodeSchema.default("TWD"),
  budget: z.number().int().positive().max(99_999_999).optional(),
  excludeRedEye: z.boolean().default(false),
  directOnly: z.boolean().default(false),
  theme: z.enum(FLIGHT_THEMES).optional(),
});
export const flightSearchDefaultsSchema = flightSearchFields.partial();
export const flightSearchIntentSchema = flightSearchFields
  .refine(
    (i) =>
      i.tripType === "one-way"
        ? i.returnDate === undefined
        : i.returnDate !== undefined && i.returnDate > i.departureDate,
    { path: ["returnDate"], message: "DATE_INVALID" },
  )
  .refine((i) => (i.adults ?? 1) + (i.children ?? 0) + (i.infants ?? 0) <= 9, {
    path: ["children"],
    message: "VALIDATION_FAILED",
  })
  .refine((i) => (i.infants ?? 0) <= (i.adults ?? 1), {
    path: ["infants"],
    message: "VALIDATION_FAILED",
  });
export type FlightSearchIntent = z.infer<typeof flightSearchIntentSchema>;

/** The party and cabin of a search with the absent-means-default rules applied. */
export function partyOf(
  intent: Pick<FlightSearchIntent, "adults" | "children" | "infants" | "cabin" | "tripType">,
): {
  adults: number;
  children: number;
  infants: number;
  /** Adults and children: the people the source prices. Infants are not in it. */
  people: number;
  cabin: FlightCabin;
  oneWay: boolean;
} {
  const adults = intent.adults ?? 1;
  const children = intent.children ?? 0;
  return {
    adults,
    children,
    infants: intent.infants ?? 0,
    people: adults + children,
    cabin: intent.cabin ?? "economy",
    oneWay: intent.tripType === "one-way",
  };
}

/** True for the fixed search that Fare History and Fare Snapshots describe: 1 adult, economy, round trip. */
export function isStandardSearch(intent: FlightSearchIntent): boolean {
  const party = partyOf(intent);
  return party.people === 1 && party.cabin === "economy" && !party.oneWay;
}
/**
 * A search carried in a query string (the LINE postback and the LIFF portal link share it);
 * null when anything is missing or invalid.
 */
/** Query string that carries a whole search: LINE postbacks, the LIFF portal and /travel share it. */
export function intentToQuery(intent: FlightSearchIntent): string {
  const params = new URLSearchParams({
    origin: intent.origin,
    destination: intent.destination,
    departureDate: intent.departureDate,
    currency: intent.currency,
    excludeRedEye: intent.excludeRedEye ? "1" : "0",
    directOnly: intent.directOnly ? "1" : "0",
  });
  if (intent.returnDate !== undefined) params.set("returnDate", intent.returnDate);
  if (intent.tripType !== undefined) params.set("tripType", intent.tripType);
  if (intent.adults !== undefined) params.set("adults", String(intent.adults));
  if (intent.children !== undefined) params.set("children", String(intent.children));
  if (intent.infants !== undefined) params.set("infants", String(intent.infants));
  if (intent.cabin !== undefined) params.set("cabin", intent.cabin);
  if (intent.budget !== undefined) params.set("budget", String(intent.budget));
  if (intent.theme !== undefined) params.set("theme", intent.theme);
  return params.toString();
}
export function intentFromQuery(params: URLSearchParams): FlightSearchIntent | null {
  const parsed = flightSearchIntentSchema.safeParse({
    origin: params.get("origin") ?? undefined,
    destination: params.get("destination") ?? undefined,
    departureDate: params.get("departureDate") ?? undefined,
    returnDate: params.get("returnDate") ?? undefined,
    tripType: params.get("tripType") ?? undefined,
    adults: params.has("adults") ? Number(params.get("adults")) : undefined,
    children: params.has("children") ? Number(params.get("children")) : undefined,
    infants: params.has("infants") ? Number(params.get("infants")) : undefined,
    cabin: params.get("cabin") ?? undefined,
    currency: params.get("currency") ?? undefined,
    budget: params.has("budget") ? Number(params.get("budget")) : undefined,
    excludeRedEye: params.get("excludeRedEye") === "1",
    directOnly: params.get("directOnly") === "1",
    theme: params.get("theme") ?? undefined,
  });
  return parsed.success ? parsed.data : null;
}
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
  /** Google listed it among its top flights; a source or cached fare without it is not top. */
  top: z.boolean().optional(),
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
  intent: Pick<FlightSearchIntent, "origin" | "destination" | "departureDate" | "currency"> &
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
  // Passenger field 8 repeats (1 adult, 2 child, 4 infant on lap); seat field 9 is 1 to 4; trip field 19 is 1 round trip, 2 one way.
  const party = partyOf(intent);
  const { oneWay } = party;
  const bytes = [
    ...leg(intent.departureDate, intent.origin, intent.destination),
    ...(oneWay || intent.returnDate === undefined
      ? []
      : leg(intent.returnDate, intent.destination, intent.origin)),
    72,
    FLIGHT_CABINS.indexOf(party.cabin) + 1,
    ...Array.from({ length: party.adults }, () => [64, 1]).flat(),
    ...Array.from({ length: party.children }, () => [64, 2]).flat(),
    ...Array.from({ length: party.infants }, () => [64, 4]).flat(),
    152,
    1,
    oneWay ? 2 : 1,
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

/** Fare Snapshots of one route and month, read by the Price Strip; `fetchedAt` is epoch ms. */
export interface FlightPriceStripReply {
  days: { date: string; price: number; fetchedAt: number }[];
}

/**
 * The Fare Ticker: the cheapest saved Fare Snapshot per destination from one origin, cheapest
 * first. `percentBelow` (whole percent under the route's usual fare) is only there when Deal
 * Signal history exists for it.
 */
export interface FlightTickerReply {
  chips: { destination: string; price: number; percentBelow?: number }[];
}
