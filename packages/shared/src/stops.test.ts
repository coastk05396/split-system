import { describe, expect, it } from "vitest";
import { stopDayInTrip, stopPatchSchema, stopTimesValid } from "./stops.js";

describe("stopDayInTrip", () => {
  it("accepts the first and last Trip day and rejects the days around them", () => {
    expect(stopDayInTrip("2026-07-01", "2026-07-01", "2026-07-03")).toBe(true);
    expect(stopDayInTrip("2026-07-03", "2026-07-01", "2026-07-03")).toBe(true);
    expect(stopDayInTrip("2026-06-30", "2026-07-01", "2026-07-03")).toBe(false);
    expect(stopDayInTrip("2026-07-04", "2026-07-01", "2026-07-03")).toBe(false);
  });

  it("leaves an unset Trip date open", () => {
    expect(stopDayInTrip("2030-01-01", "2026-07-01", null)).toBe(true);
    expect(stopDayInTrip("2020-01-01", null, null)).toBe(true);
  });
});

describe("stopTimesValid", () => {
  it("needs the end at or after the start when both are set", () => {
    expect(stopTimesValid("10:00", "10:00")).toBe(true);
    expect(stopTimesValid("10:00", "09:59")).toBe(false);
    expect(stopTimesValid(null, "09:00")).toBe(true);
  });
});

describe("stopPatchSchema", () => {
  it("rejects an empty patch and unknown fields", () => {
    expect(stopPatchSchema.safeParse({}).success).toBe(false);
    expect(stopPatchSchema.safeParse({ groupId: "x" }).success).toBe(false);
    expect(stopPatchSchema.safeParse({ notes: null }).success).toBe(true);
  });
});
