import { googleFlightsUrl, type FlightCard, type FlightSearchIntent } from "@split/shared";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp } from "../../test/render-app.js";
import { makeUser } from "../../test/fake-api.js";

const intent = (destination: string): FlightSearchIntent => ({
  origin: "TPE",
  destination,
  departureDate: "2027-01-08",
  returnDate: "2027-01-11",
  currency: "TWD",
  excludeRedEye: false,
  directOnly: false,
});

const card = (destination: string, price: number, stops: number): FlightCard => ({
  price,
  airline: "Example Air",
  outboundDeparture: "08:00",
  outboundArrival: "12:00",
  inboundDeparture: null,
  inboundArrival: null,
  stops,
  durationMinutes: 180,
  priceLevel: "low",
  intent: intent(destination),
  signal: "strong_buy",
  overBudget: 0,
  url: googleFlightsUrl(intent(destination)),
});

const user = makeUser("Rick");

describe("探索 page", () => {
  it("shows the lowest direct fare as the hero on a bare /travel, with 探索 current", async () => {
    const { api, router } = renderApp({ path: "/travel", cookieUser: user });
    api.flightHighlights.push(card("KIX", 8000, 1), card("NRT", 9500, 0), card("OKA", 12000, 0));
    const hero = await screen.findByRole("region", { name: "最低直飛票價" });
    expect(await within(hero).findByText("最低")).toBeVisible();
    expect(within(hero).getByText(/9,500/)).toBeVisible();
    expect(within(hero).getByText(/TPE → NRT/)).toBeVisible();
    expect(within(hero).getByRole("img", { name: /.+/ })).toBeVisible();
    expect(screen.getByRole("heading", { level: 1, name: "下一站，東京！" })).toBeVisible();
    expect(router.state.location.pathname).toBe("/travel");
    expect(
      within(screen.getByRole("navigation", { name: "底部導覽" })).getByRole("link", {
        name: "探索",
      }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("says so when no direct fare is confirmed today", async () => {
    const { api } = renderApp({ path: "/travel", cookieUser: user });
    api.flightHighlights.push(card("KIX", 8000, 1));
    expect(await screen.findByText("今天還沒有已確認的直飛優惠。")).toBeVisible();
  });

  it("shows a retry when the fares fail to load, and recovers", async () => {
    const { api } = renderApp({ path: "/travel", cookieUser: user });
    api.failNext("GET /api/v1/flights/highlights");
    api.flightHighlights.push(card("NRT", 9500, 0));
    expect(await screen.findByRole("alert")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "再試一次" }));
    expect(await screen.findByRole("region", { name: "最低直飛票價" })).toBeVisible();
  });

  it("sends a 小芽 prompt to 航班, which runs the existing prompt search", async () => {
    const { api, router } = renderApp({ path: "/travel", cookieUser: user });
    fireEvent.change(await screen.findByRole("textbox", { name: "想去哪裡？" }), {
      target: { value: "下個月去東京" },
    });
    fireEvent.click(screen.getByRole("button", { name: "問小芽" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/travel/flights");
    });
    await waitFor(() => {
      expect(api.requests.some((r) => r.route === "POST /api/v1/flights/search")).toBe(true);
    });
    const request = api.requests.find((r) => r.route === "POST /api/v1/flights/search");
    expect(JSON.parse(request?.body ?? "{}")).toMatchObject({ prompt: "下個月去東京" });
  });

  it("still sends /travel with search parameters to 航班", async () => {
    const { router } = renderApp({
      path: "/travel?origin=TPE&destination=NRT&departureDate=2027-01-08&returnDate=2027-01-11&currency=TWD&excludeRedEye=0&directOnly=0",
      cookieUser: user,
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/travel/flights");
    });
    expect(new URLSearchParams(router.state.location.search).get("destination")).toBe("NRT");
  });
});
