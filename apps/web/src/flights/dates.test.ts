import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "../i18n/messages.js";
import { friendlyDate, friendlyRange, shortDate } from "./dates.js";

describe("flight dates", () => {
  afterEach(() => {
    setLocale("zh-TW");
  });

  it("writes Traditional Chinese M/D with the right weekday", () => {
    setLocale("zh-TW");
    expect(shortDate("2026-12-04")).toBe("12/4");
    expect(friendlyDate("2026-12-04")).toBe("12/4（五）");
    expect(friendlyDate("2027-01-03")).toBe("1/3（日）");
    expect(friendlyRange("2026-12-04", "2026-12-07")).toBe("12/4（五）– 12/7（一）");
  });

  it("writes English Mon D without a weekday", () => {
    setLocale("en");
    expect(shortDate("2026-12-04")).toBe("Dec 4");
    expect(friendlyDate("2027-01-03")).toBe("Jan 3");
    expect(friendlyRange("2026-12-04", "2026-12-07")).toBe("Dec 4 – Dec 7");
  });
});
