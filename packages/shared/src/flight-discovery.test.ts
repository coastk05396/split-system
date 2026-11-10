import { expect, it } from "vitest";
import { anchorFlightDates } from "./flight-discovery.js";
it("anchors next month's nearest Friday to an exact three- or four-day weekend", () => {
  const now = Date.parse("2026-11-07T02:00:00Z");
  expect(anchorFlightDates("next_month_weekend", 4, now)).toEqual({
    departureDate: "2026-12-04",
    returnDate: "2026-12-07",
  });
  expect(anchorFlightDates("next_month_weekend", 3, now)).toEqual({
    departureDate: "2026-12-04",
    returnDate: "2026-12-06",
  });
  expect(anchorFlightDates("next_weekend", 3, Date.parse("2026-12-31T10:00:00Z"))).toEqual({
    departureDate: "2027-01-01",
    returnDate: "2027-01-03",
  });
});
