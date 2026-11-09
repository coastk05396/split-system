import { flightFareSchema, type FlightFare, type FlightSearchIntent } from "@split/shared";
import { z } from "zod";
import type { Bindings } from "../env.js";

export type FlightSource = (intent: FlightSearchIntent, env: Bindings) => Promise<FlightFare[]>;

export const containerFlightSource: FlightSource = async (intent, env) => {
  if (!env.FLIGHT_CONTAINER) throw new Error("flight source unavailable");
  const container = env.FLIGHT_CONTAINER.get(env.FLIGHT_CONTAINER.idFromName("flight-radar"));
  const response = await container.fetch("https://flights/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(intent),
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error("flight source unavailable");
  return z
    .array(flightFareSchema)
    .max(20)
    .parse(await response.json());
};
