import { z } from "zod";
import { flightSearchIntentSchema } from "./flights.js";

export const createFlightWatchSchema = z.object({
  intent: flightSearchIntentSchema,
  baselineFare: z.number().int().positive().max(99_999_999),
  targetFare: z.number().int().positive().max(99_999_999),
  channel: z.enum(["web_push", "line_push"]),
});
export type CreateFlightWatch = z.infer<typeof createFlightWatchSchema>;
export interface FlightPriceWatch extends CreateFlightWatch {
  id: string;
  status: "active" | "triggered" | "expired" | "cancelled";
  latestFare: number | null;
  checkedAt: number | null;
  createdAt: number;
}
export interface FlightWatchesReply {
  watches: FlightPriceWatch[];
}
export const pushSubscriptionSchema = z.object({
  endpoint: z
    .url()
    .max(2048)
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.port &&
        ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"].some(
          (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
        )
      );
    }),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}=?$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}={0,2}$/),
  }),
});
export type WebPushSubscription = z.infer<typeof pushSubscriptionSchema>;
