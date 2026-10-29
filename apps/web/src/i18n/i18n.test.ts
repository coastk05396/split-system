import { describe, expect, it } from "vitest";
import { categoryLabel, localName, longDate, weekdayShort } from "./format.js";
import { catalogs, errorMessage, setLocale, t } from "./messages.js";

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("catalogs", () => {
  it("fill the same placeholders in English as in Chinese for every message", () => {
    for (const id of Object.keys(catalogs["zh-TW"]) as (keyof (typeof catalogs)["zh-TW"])[]) {
      expect(placeholders(catalogs.en[id]), id).toEqual(placeholders(catalogs["zh-TW"][id]));
    }
  });

  it("switches every message and error with the language", () => {
    expect(t("nav.settings")).toBe("設定");
    expect(errorMessage("FORBIDDEN")).toBe("你沒有權限進行這個操作。");
    setLocale("en");
    expect(t("nav.settings")).toBe("Settings");
    expect(t("home.greeting", { name: "Yu" })).toBe("Yu, what shall we split today?");
    expect(errorMessage("FORBIDDEN")).toBe("You do not have permission to do this.");
  });
});

describe("labels the server stores in Chinese", () => {
  it("shows categories and the deleted or removed member in the app's language", () => {
    expect(categoryLabel("餐飲")).toBe("餐飲");
    expect(localName("已刪除的使用者")).toBe("已刪除的使用者");
    setLocale("en");
    expect(categoryLabel("餐飲")).toBe("Food & drink");
    expect(categoryLabel("醫療")).toBe("Medical");
    expect(categoryLabel("自己打的")).toBe("自己打的");
    expect(localName("已刪除的使用者")).toBe("Deleted user");
    expect(localName("已移除的成員")).toBe("Removed member");
    expect(localName("小宇")).toBe("小宇");
  });
});

describe("dates", () => {
  it("are written in the app's language", () => {
    expect(longDate("2026-10-29")).toBe("2026年10月29日");
    expect(weekdayShort("2026-06-13")).toBe("六");
    setLocale("en");
    expect(longDate("2026-10-29")).toBe("October 29, 2026");
    expect(weekdayShort("2026-06-13")).toBe("Sat");
  });
});
