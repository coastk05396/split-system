import { defaultFlightIntent } from "@split/shared";
import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import { renderApp } from "../../test/render-app.js";

const intent = defaultFlightIntent(Date.now(), "TWD");
const month = intent.departureDate.slice(0, 7);
const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
const day = (n: number) => `${month}-${String(n).padStart(2, "0")}`;
const HOUR = 3_600_000;

const text = {
  en: {
    title: `Cheapest fare by day, ${month.replace("-", "/")}`,
    unavailable: "Prices are unavailable right now",
    loading: "Loading prices",
    note: "Saved prices: round trip with a 3-day stay, 1 adult, economy, the day's lowest. They can differ from the trip you chose.",
    age: "Updated 40 h ago",
  },
  "zh-TW": {
    title: `${month.replace("-", "/")} 每日最低價`,
    unavailable: "目前無法取得價格",
    loading: "價格載入中",
    note: "已儲存的價格：停留 3 天的來回票，1 位成人、經濟艙，取當日最低。可能與你選的行程不同。",
    age: "40 小時前更新",
  },
} as const;
type Language = keyof typeof text;

function setup(language: Language) {
  return renderApp({ path: "/travel/flights", cookieUser: { ...makeUser("Rick"), language } });
}
const strip = (language: Language) => screen.findByRole("region", { name: text[language].title });
const original = window.matchMedia.bind(window);
afterEach(() => {
  window.matchMedia = original;
});

describe("Flight Radar Price Strip", () => {
  it.each(["en", "zh-TW"] as const)(
    "draws a bar per day from saved prices with the cheapest days marked, never searching, in %s",
    async (language) => {
      const app = setup(language);
      const fetchedAt = Date.now();
      app.api.flightPriceStrip = [
        { date: day(3), price: 9000, fetchedAt },
        { date: day(4), price: 5000, fetchedAt },
        { date: day(5), price: 7000, fetchedAt },
        { date: day(6), price: 5000, fetchedAt },
      ];
      const section = await strip(language);
      const bars = await within(section).findAllByRole("listitem");
      expect(bars).toHaveLength(daysInMonth);
      const marked = bars.filter((bar) => bar.dataset.cheapest === "true");
      expect(marked.map((bar) => bar.getAttribute("aria-label"))).toEqual([
        expect.stringContaining("NT$ 5,000"),
        expect.stringContaining("NT$ 5,000"),
      ]);
      expect(bars[2]).toHaveAccessibleName(expect.stringContaining("NT$ 9,000"));
      expect(bars[2]?.dataset.cheapest).toBeUndefined();
      expect(within(section).getByText(text[language].note)).toBeVisible();
      // Fresh data carries no age note, and nothing here searched.
      expect(within(section).queryByText(/小時前更新|h ago/)).toBeNull();
      expect(app.api.calls).not.toContain("POST /api/v1/flights/search");
      expect(app.api.flightPriceStripQueries).toEqual([
        `?origin=TPE&destination=OKA&currency=TWD&month=${month}`,
      ]);
    },
  );

  it.each(["en", "zh-TW"] as const)(
    "shows grey skeleton bars that do not pulse under reduced motion, then the bars, in %s",
    async (language) => {
      const app = setup(language);
      app.api.flightPriceStrip = [{ date: day(3), price: 9000, fetchedAt: Date.now() }];
      const release = app.api.holdResponses("GET /api/v1/flights/price-strip");
      const skeleton = await screen.findByRole("status", { name: text[language].loading });
      expect(skeleton.children).toHaveLength(daysInMonth);
      expect(skeleton.querySelector(".strip-pulse")).toBeNull();
      release();
      await waitFor(() => {
        expect(screen.queryByRole("status", { name: text[language].loading })).toBeNull();
      });
      expect(await within(await strip(language)).findAllByRole("listitem")).toHaveLength(
        daysInMonth,
      );
    },
  );

  it("pulses the skeleton when motion is allowed", async () => {
    window.matchMedia = (query) => ({ matches: false, media: query }) as MediaQueryList;
    const app = setup("en");
    const release = app.api.holdResponses("GET /api/v1/flights/price-strip");
    const skeleton = await screen.findByRole("status", { name: text.en.loading });
    expect(skeleton.querySelector(".strip-pulse")).not.toBeNull();
    release();
  });

  it.each(["en", "zh-TW"] as const)("says how old old prices are in %s", async (language) => {
    const app = setup(language);
    app.api.flightPriceStrip = [
      { date: day(3), price: 9000, fetchedAt: Date.now() - 30 * HOUR },
      { date: day(4), price: 8000, fetchedAt: Date.now() - 40 * HOUR },
    ];
    const section = await strip(language);
    // The oldest price decides how stale the strip is.
    expect(await within(section).findByText(text[language].age)).toBeVisible();
  });

  it.each(["en", "zh-TW"] as const)(
    "shows a plain unavailable line, no bars and no spinner, when there are no prices in %s",
    async (language) => {
      setup(language);
      const section = await strip(language);
      expect(await within(section).findByText(text[language].unavailable)).toBeVisible();
      expect(within(section).queryAllByRole("listitem")).toHaveLength(0);
      expect(screen.queryByRole("status", { name: text[language].loading })).toBeNull();
    },
  );

  it.each(["en", "zh-TW"] as const)(
    "shows the same unavailable line when the request fails in %s",
    async (language) => {
      const app = setup(language);
      app.api.failNext("GET /api/v1/flights/price-strip");
      const section = await strip(language);
      expect(await within(section).findByText(text[language].unavailable)).toBeVisible();
      expect(screen.queryByRole("status", { name: text[language].loading })).toBeNull();
    },
  );
});
