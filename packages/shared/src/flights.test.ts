import { describe, expect, it } from "vitest";
import {
  flightSearchIntentSchema,
  type FlightSearchIntent,
  googleFlightsUrl,
  intentFromQuery,
  intentToQuery,
  isStandardSearch,
  partyOf,
} from "./flights.js";

const base = {
  origin: "TPE",
  destination: "NRT",
  departureDate: "2026-12-04",
  returnDate: "2026-12-07",
  currency: "TWD" as const,
};
const tail = (extra: Partial<FlightSearchIntent>) => {
  const tfs = new URL(googleFlightsUrl({ ...base, ...extra })).searchParams.get("tfs") ?? "";
  const bytes = atob(tfs.replace(/-/g, "+").replace(/_/g, "/"));
  return { bytes, tail: Array.from(bytes, (c) => c.charCodeAt(0)) };
};
describe("Passengers, cabin and one way", () => {
  const parse = (extra: object) =>
    flightSearchIntentSchema.safeParse({
      ...base,
      excludeRedEye: false,
      directOnly: false,
      ...extra,
    });
  it("keeps a search without the new fields valid and standard", () => {
    const result = parse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(isStandardSearch(result.data)).toBe(true);
      expect(partyOf(result.data)).toEqual({
        adults: 1,
        children: 0,
        infants: 0,
        people: 1,
        cabin: "economy",
        oneWay: false,
      });
    }
  });
  it("accepts a one-way search only without a return date", () => {
    expect(parse({ tripType: "one-way", returnDate: undefined }).success).toBe(true);
    expect(parse({ tripType: "one-way" }).success).toBe(false);
    expect(parse({ returnDate: undefined }).success).toBe(false);
  });
  it("limits the party to 9 and rejects unknown cabins", () => {
    expect(parse({ adults: 9 }).success).toBe(true);
    expect(parse({ adults: 5, children: 5 }).success).toBe(false);
    expect(parse({ adults: 0 }).success).toBe(false);
    expect(parse({ cabin: "coach" }).success).toBe(false);
  });
  it("carries infants: never more than adults, nine travellers at most, priced as no one", () => {
    expect(parse({ adults: 2, infants: 2 }).success).toBe(true);
    expect(parse({ adults: 1, infants: 2 }).success).toBe(false);
    expect(parse({ adults: 5, children: 3, infants: 2 }).success).toBe(false);
    expect(parse({ adults: 5, children: 2, infants: 2 }).success).toBe(true);
    expect(parse({ infants: -1 }).success).toBe(false);
    const result = parse({ adults: 2, infants: 1 });
    expect(result.success && partyOf(result.data)).toMatchObject({ infants: 1, people: 2 });
    expect(partyOf({}).infants).toBe(0);
    // The source price never includes infants, so they do not make a search non-standard.
    const alone = parse({ infants: 1 });
    expect(alone.success && isStandardSearch(alone.data)).toBe(true);
  });
  it("is not standard when the party, cabin or trip type differ", () => {
    for (const extra of [
      { adults: 2 },
      { children: 1 },
      { cabin: "first" },
      { tripType: "one-way", returnDate: undefined },
    ]) {
      const result = parse(extra);
      expect(result.success && isStandardSearch(result.data)).toBe(false);
    }
  });
  it("round-trips through the query string and omits defaults", () => {
    const intent = flightSearchIntentSchema.parse({
      ...base,
      excludeRedEye: false,
      directOnly: false,
      adults: 2,
      children: 1,
      infants: 1,
      cabin: "business",
    });
    expect(intentToQuery(intent)).toContain("infants=1");
    expect(intentFromQuery(new URLSearchParams(intentToQuery(intent)))).toEqual(intent);
    const plain = flightSearchIntentSchema.parse({
      ...base,
      excludeRedEye: false,
      directOnly: false,
    });
    expect(intentToQuery(plain)).not.toMatch(/adults|children|cabin|tripType/);
  });
  it("encodes party, cabin and trip type in the Google handoff", () => {
    expect(tail({ adults: 2, children: 1, cabin: "business" }).tail.slice(-11)).toEqual([
      72, 3, 64, 1, 64, 1, 64, 2, 152, 1, 1,
    ]);
    // Infants ride the link as lap infants (passenger 4), after adults and children.
    expect(tail({ adults: 2, infants: 1 }).tail.slice(-11)).toEqual([
      72, 1, 64, 1, 64, 1, 64, 4, 152, 1, 1,
    ]);
    const oneWay = tail({ tripType: "one-way", returnDate: undefined, cabin: "first" });
    expect(oneWay.tail.slice(-7)).toEqual([72, 4, 64, 1, 152, 1, 2]);
    expect(oneWay.bytes).not.toContain("2026-12-07");
  });
});
describe("Google Flights handoff", () => {
  it("encodes an adult economy round trip using the published protobuf fields", () => {
    const url = new URL(
      googleFlightsUrl({
        origin: "TPE",
        destination: "NRT",
        departureDate: "2026-12-04",
        returnDate: "2026-12-07",
        currency: "TWD",
      }),
    );
    expect(url.hostname).toBe("www.google.com");
    expect(url.searchParams.get("curr")).toBe("TWD");
    const tfs = url.searchParams.get("tfs");
    expect(tfs).not.toBeNull();
    if (tfs === null) throw new Error("Missing flight query");
    const bytes = atob(tfs.replace(/-/g, "+").replace(/_/g, "/"));
    expect(bytes).toContain("2026-12-04");
    expect(bytes).toContain("2026-12-07");
    expect(bytes).toContain("TPE");
    expect(bytes).toContain("NRT");
    expect(Array.from(bytes.slice(-7), (c) => c.charCodeAt(0))).toEqual([72, 1, 64, 1, 152, 1, 1]);
  });
});
