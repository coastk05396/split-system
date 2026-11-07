import { describe, expect, it } from "vitest";
import { googleFlightsUrl } from "./flights.js";
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
    const bytes = atob(url.searchParams.get("tfs")!.replace(/-/g, "+").replace(/_/g, "/"));
    expect(bytes).toContain("2026-12-04");
    expect(bytes).toContain("2026-12-07");
    expect(bytes).toContain("TPE");
    expect(bytes).toContain("NRT");
    expect(Array.from(bytes.slice(-7), (c) => c.charCodeAt(0))).toEqual([72, 1, 64, 1, 152, 1, 1]);
  });
});
