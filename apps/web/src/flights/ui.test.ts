import { describe, expect, it } from "vitest";
import { formatFareDates } from "./ui.js";

describe("formatFareDates", () => {
  it.each([
    ["same month", "2026-12-01", "2026-12-05", "zh-TW", "12月1日 – 5日"],
    ["cross month", "2026-12-28", "2027-01-03", "zh-TW", "12月28日 – 1月3日"],
    ["one-way", "2026-12-01", null, "zh-TW", "12月1日"],
    ["same day", "2026-12-09", "2026-12-09", "zh-TW", "12月9日 當天來回"],
    ["same month (en)", "2026-12-01", "2026-12-05", "en", "Dec 1 – 5"],
    ["cross month (en)", "2026-12-28", "2027-01-03", "en", "Dec 28 – Jan 3"],
    ["one-way (en)", "2026-12-01", null, "en", "Dec 1"],
    ["same day (en)", "2026-12-09", "2026-12-09", "en", "Dec 9 · same day"],
  ] as const)("%s", (_name, out, back, lang, expected) => {
    expect(formatFareDates(out, back, lang)).toBe(expected);
  });

  it("falls back to the raw text for a malformed date instead of throwing", () => {
    expect(formatFareDates("soon", "2026-12-05", "zh-TW")).toBe("soon");
    expect(formatFareDates("2026-12-01", "later", "zh-TW")).toBe("12月1日");
  });
});
