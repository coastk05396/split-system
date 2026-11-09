import type { FlightPriceWatch } from "@split/shared";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import { openSearchPanel } from "../../test/flight-panel.js";
import { renderApp } from "../../test/render-app.js";

const watch: FlightPriceWatch = {
  id: "w1",
  status: "active",
  channel: "web_push",
  intent: {
    origin: "TPE",
    destination: "NRT",
    departureDate: "2027-01-08",
    returnDate: "2027-01-11",
    currency: "TWD",
    excludeRedEye: false,
    directOnly: false,
  },
  baselineFare: 20000,
  targetFare: 17000,
  latestFare: null,
  checkedAt: null,
  createdAt: 1,
};

describe("Price Watch list page", () => {
  it.each(["zh-TW", "en"] as const)(
    "lists watches under /travel/watches with the 追蹤 tab current in %s",
    async (language) => {
      const en = language === "en";
      const { api } = renderApp({
        path: "/travel/watches",
        cookieUser: { ...makeUser("Rick"), language },
      });
      api.flightWatches = [watch];
      const list = await screen.findByRole("region", {
        name: en ? "My Price Watches" : "我的降價雷達",
      });
      expect(await within(list).findByText(/TPE → NRT/)).toBeVisible();
      const navs = en ? ["Bottom navigation", "Side navigation"] : ["底部導覽", "側邊導覽"];
      for (const name of navs) {
        const nav = within(screen.getByRole("navigation", { name }));
        expect(nav.getAllByRole("link").map((l) => l.textContent)).toEqual(
          en ? ["Split", "Explore", "Flights", "Watches"] : ["分帳", "探索", "航班", "追蹤"],
        );
        expect(nav.getByRole("link", { name: en ? "Watches" : "追蹤" })).toHaveAttribute(
          "aria-current",
          "page",
        );
        expect(nav.getByRole("link", { name: en ? "Flights" : "航班" })).not.toHaveAttribute(
          "aria-current",
        );
      }
      fireEvent.click(within(list).getByRole("button", { name: en ? "Cancel watch" : "取消追蹤" }));
      await waitFor(() => {
        expect(within(list).queryByText(/TPE → NRT/)).toBeNull();
      });
      expect(
        await within(list).findByText(en ? "No Price Watches yet." : "還沒有追蹤中的航線。"),
      ).toBeVisible();
    },
  );

  it("shows the empty state", async () => {
    renderApp({ path: "/travel/watches", cookieUser: makeUser("Rick") });
    expect(await screen.findByText("還沒有追蹤中的航線。")).toBeVisible();
  });

  it("shows an error when the list cannot load", async () => {
    const { api } = renderApp({ path: "/travel/watches", cookieUser: makeUser("Rick") });
    api.failNext("GET /api/v1/flights/watches");
    expect(await screen.findByRole("alert")).toBeVisible();
  });

  it("opens from the 追蹤 tab", async () => {
    const { router } = renderApp({ path: "/travel/flights", cookieUser: makeUser("Rick") });
    await screen.findByRole("heading", { name: "下一站，沖繩！" });
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "底部導覽" })).getByRole("link", {
        name: "追蹤",
      }),
    );
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/travel/watches");
    });
  });

  it("links the radar bell to the page", async () => {
    renderApp({ path: "/travel/flights", cookieUser: makeUser("Rick") });
    await openSearchPanel();
    const bell = await screen.findByRole("link", { name: "降價雷達" });
    expect(bell).toHaveAttribute("href", "/travel/watches");
    expect(bell).toHaveClass("fr-ic", "fr-hit");
  });
});
