import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp } from "../../test/render-app.js";
import { makeUser } from "../../test/fake-api.js";

const names = {
  "zh-TW": {
    bottom: "底部導覽",
    side: "側邊導覽",
    split: ["首頁", "旅遊", "新增", "統計", "設定"],
    travel: ["首頁", "搜尋", "追蹤"],
    search: "搜尋",
    heading: "下一站，沖繩！",
  },
  en: {
    bottom: "Bottom navigation",
    side: "Side navigation",
    split: ["Home", "Trips", "Add", "Stats", "Settings"],
    travel: ["Home", "Search", "Watches"],
    search: "Search",
    heading: "Next stop, Okinawa!",
  },
} as const;

/** The links and the Search key (a button) of a nav, in order. */
const labels = (nav: HTMLElement) =>
  [...nav.querySelectorAll("a, button")].map((item) => item.textContent);

describe("Travel mode", () => {
  it.each(["zh-TW", "en"] as const)(
    "swaps the bottom nav to 首頁, the Search key and 追蹤 under /travel in %s",
    async (language) => {
      const n = names[language];
      renderApp({ path: "/travel", cookieUser: { ...makeUser("Rick"), language } });
      await screen.findByRole("heading", { name: n.heading });
      for (const name of [n.bottom, n.side]) {
        const nav = screen.getByRole("navigation", { name });
        expect(labels(nav)).toEqual([...n.travel]);
        expect(within(nav).getByRole("button", { name: n.search })).toHaveAttribute(
          "aria-current",
          "page",
        );
      }
      const bottom = within(screen.getByRole("navigation", { name: n.bottom }));
      expect(bottom.getByRole("link", { name: n.travel[0] })).toHaveAttribute("href", "/");
      expect(bottom.getByRole("link", { name: n.travel[2] })).toHaveAttribute(
        "href",
        "/travel/watches",
      );
      expect(screen.queryByRole("link", { name: n.split[2] })).toBeNull();
      expect(screen.queryByRole("link", { name: n.split[3] })).toBeNull();
    },
  );

  it("keeps the splitting nav on 首頁 and enters Travel mode from 旅遊", async () => {
    const { router } = renderApp({ path: "/", cookieUser: makeUser("Rick") });
    const bottom = await screen.findByRole("navigation", { name: "底部導覽" });
    expect(labels(bottom)).toEqual(["首頁", "旅遊", "新增", "統計", "設定"]);
    fireEvent.click(within(bottom).getByRole("link", { name: "旅遊" }));
    await screen.findByRole("heading", { name: "下一站，沖繩！" });
    expect(router.state.location.pathname).toBe("/travel");
    expect(labels(screen.getByRole("navigation", { name: "底部導覽" }))).toEqual([
      "首頁",
      "搜尋",
      "追蹤",
    ]);
  });

  it("returns to 首頁 and the splitting nav from 首頁", async () => {
    const { router } = renderApp({ path: "/travel", cookieUser: makeUser("Rick") });
    await screen.findByRole("heading", { name: "下一站，沖繩！" });
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "底部導覽" })).getByRole("link", {
        name: "首頁",
      }),
    );
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
    expect(labels(await screen.findByRole("navigation", { name: "底部導覽" }))).toEqual([
      "首頁",
      "旅遊",
      "新增",
      "統計",
      "設定",
    ]);
  });

  it("runs a /travel?... link's search once and redirects the old /travel path with its query", async () => {
    const query =
      "origin=TPE&destination=NRT&departureDate=2027-01-08&returnDate=2027-01-11&currency=TWD&budget=15000&excludeRedEye=1&directOnly=0";
    const { router, api } = renderApp({
      path: `/travel?${query}`,
      cookieUser: makeUser("Rick"),
    });
    expect(await screen.findByRole("link", { name: /Example Air/ })).toBeVisible();
    expect(router.state.location.pathname).toBe("/travel");
    expect(new URLSearchParams(router.state.location.search).get("destination")).toBe("NRT");
    expect(api.requests.filter((r) => r.route === "POST /api/v1/flights/search")).toHaveLength(1);
  });

  it("keeps Travel mode after a refresh of a travel URL", async () => {
    renderApp({ path: "/travel", cookieUser: makeUser("Rick") });
    await screen.findByRole("heading", { name: "下一站，沖繩！" });
    expect(screen.queryByRole("link", { name: "統計" })).toBeNull();
  });
});
