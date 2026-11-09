import { z } from "zod";
import { flightFareSchema, flightSearchIntentSchema, type FlightSearchIntent } from "./flights.js";
import { LANGUAGES } from "./labels.js";

/** A structured edit of the active Entity Pills; tapping a chip applies it with no prompt parse. */
export type SearchIntentPatch = Partial<FlightSearchIntent>;
export interface AdaptiveNextMove {
  id: string;
  label: string;
  patch: SearchIntentPatch;
}
export interface FlightAdviceReply {
  commentary: string;
  moves: AdaptiveNextMove[];
}

/** Facts from the finished search; the server words the commentary from these alone. */
export const flightAdviceRequestSchema = z.object({
  language: z.enum(LANGUAGES),
  intent: flightSearchIntentSchema,
  cards: z
    .array(
      flightFareSchema.extend({
        signal: z.enum(["strong_buy", "buy", "hold"]),
        overBudget: z.number().int().min(0),
        intent: flightSearchIntentSchema,
      }),
    )
    .min(1)
    .max(20),
});
export type FlightAdviceRequest = z.infer<typeof flightAdviceRequestSchema>;

/** A swapped destination replaces a theme, otherwise the theme would keep choosing the routes. */
export function applyIntentPatch(
  intent: FlightSearchIntent,
  patch: SearchIntentPatch,
): FlightSearchIntent {
  const { theme: _theme, ...withoutTheme } = intent;
  return { ...(patch.destination && !patch.theme ? withoutTheme : intent), ...patch };
}
