import { describe, expect, it } from "vitest";
import { applyIntentPatch } from "./flight-advice.js";
import type { FlightSearchIntent } from "./flights.js";

const intent: FlightSearchIntent = {
  origin: "TPE",
  destination: "OKA",
  theme: "warm_island",
  departureDate: "2026-12-04",
  returnDate: "2026-12-07",
  currency: "TWD",
  budget: 15000,
  excludeRedEye: false,
  directOnly: true,
};

describe("applyIntentPatch", () => {
  it("merges the patch and keeps untouched conditions", () => {
    expect(applyIntentPatch(intent, { directOnly: false })).toEqual({
      ...intent,
      directOnly: false,
    });
  });
  it("lets a swapped destination replace the theme that chose the routes", () => {
    const next = applyIntentPatch(intent, { destination: "HKT" });
    expect(next.destination).toBe("HKT");
    expect(next).not.toHaveProperty("theme");
  });
});
