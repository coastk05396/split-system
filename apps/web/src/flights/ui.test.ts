import { describe, expect, it } from "vitest";
import { formatFareDates } from "./ui.js";

describe("formatFareDates", () => {
  it.each([
    ["same month", "2026-12-09", "2026-12-12", "12/09–12/12"],
    ["cross month", "2026-12-28", "2027-01-03", "12/28–01/03"],
    ["zero-padded", "2027-01-07", "2027-02-02", "01/07–02/02"],
    ["one-way", "2026-12-09", null, "12/09"],
    ["same day", "2026-12-09", "2026-12-09", "12/09"],
  ] as const)("%s", (_name, out, back, expected) => {
    expect(formatFareDates(out, back)).toBe(expected);
  });

  it("falls back to the raw text for a malformed date instead of throwing", () => {
    expect(formatFareDates("soon", "2026-12-05")).toBe("soon");
    expect(formatFareDates("2026-12-01", "later")).toBe("12/01");
  });
});
