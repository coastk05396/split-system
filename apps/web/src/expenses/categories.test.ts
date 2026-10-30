import { describe, expect, it } from "vitest";
import { CATEGORIES, categoryInfo, categoryLabel } from "./categories.js";
import { setLocale } from "../i18n/messages.js";

describe("Expense category knowledge", () => {
  it("keeps picker categories, icons, shared-card emoji and translated labels together", () => {
    expect(CATEGORIES).toEqual(["餐飲", "交通", "住宿", "購物", "娛樂", "醫療", "其他"]);
    expect(categoryInfo("餐飲")).toMatchObject({ icon: "food", emoji: "🍽️" });
    setLocale("en");
    expect(categoryLabel("餐飲")).toBe("Food & drink");
    setLocale("zh-TW");
  });
  it("preserves unknown and legacy names and falls back safely", () => {
    expect(categoryLabel("門票")).toBe("門票");
    expect(categoryInfo("門票")).toMatchObject({ icon: "fun", emoji: "🎟️" });
    for (const name of ["自訂", "constructor", "__proto__"]) {
      expect(categoryLabel(name)).toBe(name);
      expect(categoryInfo(name)).toMatchObject({ icon: "other", emoji: "✨" });
    }
  });
});
