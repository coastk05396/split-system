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

  it("ignores a cheaper direct fare that does not depart from 台北", async () => {
    const { api } = renderApp({ path: "/travel", cookieUser: user });
    const khh = card("NRT", 5000, 0);
    khh.intent = { ...khh.intent, origin: "KHH" };
    api.flightHighlights.push(khh, card("OKA", 12000, 0));
    const hero = await screen.findByRole("region", { name: "最低直飛票價" });
    expect(await within(hero).findByText(/TPE → OKA/)).toBeVisible();
    expect(within(hero).queryByText(/KHH/)).toBeNull();
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

  it("runs a handed 小芽 prompt once under StrictMode's effect replay", async () => {
    const { api, router } = renderApp({ path: "/travel", cookieUser: user, strictMode: true });
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
    const prompts = api.requests.filter(
      (r) => r.route === "POST /api/v1/flights/search" && r.body?.includes("下個月去東京"),
    );
    expect(prompts).toHaveLength(1);
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

  describe("date tiles and call to action", () => {
    const fare = (price: number, departureDate: string, returnDate: string) => ({
      price,
      airline: "Example Air",
      departureDate,
      returnDate,
      outboundDeparture: "08:00",
      outboundArrival: "12:00",
      inboundDeparture: "18:00",
      inboundArrival: "20:00",
      stops: 0,
      durationMinutes: 180,
      priceLevel: "low" as const,
    });
    const fares = [
      fare(9800, "2027-01-07", "2027-01-10"),
      fare(9500, "2027-01-08", "2027-01-11"),
      fare(9900, "2027-01-08", "2027-01-11"),
      fare(11000, "2027-01-09", "2027-01-12"),
    ];

    it("prices the dates, and the call to action follows the selected tile into 航班", async () => {
      const { api, router } = renderApp({ path: "/travel", cookieUser: user });
      api.flightHighlights.push(card("NRT", 9500, 0));
      api.flightFares.splice(0, api.flightFares.length, ...fares);
      const dates = await screen.findByRole("region", { name: "挑個好日子起飛" });
      const tiles = within(dates).getAllByRole("button");
      expect(tiles).toHaveLength(3);
      expect(
        within(dates).getByRole("button", { name: "1/8（五） · NT$ 9,500 · 已選 · 最低" }),
      ).toBeVisible();
      const cta = screen.getByRole("link", { name: /2 班航班，等你挑一班/ });
      expect(cta).toHaveTextContent("NT$ 9,500");
      fireEvent.click(within(dates).getByRole("button", { name: /1\/9/ }));
      const next = screen.getByRole("link", { name: /1 班航班，等你挑一班/ });
      expect(next).toHaveTextContent("NT$ 11,000");
      fireEvent.click(next);
      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/travel/flights");
      });
      const query = new URLSearchParams(router.state.location.search);
      expect(query.get("destination")).toBe("NRT");
      expect(query.get("departureDate")).toBe("2027-01-09");
      expect(query.get("returnDate")).toBe("2027-01-12");
      await waitFor(() => {
        expect(
          api.requests.filter((r) => r.route === "POST /api/v1/flights/search").length,
        ).toBeGreaterThan(1);
      });
    });

    it("amber marks only the 最低 tile", async () => {
      const { api } = renderApp({ path: "/travel", cookieUser: user });
      api.flightHighlights.push(card("NRT", 9500, 0));
      api.flightFares.splice(0, api.flightFares.length, ...fares);
      const dates = await screen.findByRole("region", { name: "挑個好日子起飛" });
      const amber = within(dates)
        .getAllByRole("button")
        .filter((b) => b.dataset["lowest"] === "true");
      expect(amber).toHaveLength(1);
      expect(amber[0]).toHaveAccessibleName(/最低/);
    });

    it("shows the unavailable message with a retry when the search is degraded, not the empty one", async () => {
      const { api } = renderApp({ path: "/travel", cookieUser: user });
      api.flightHighlights.push(card("NRT", 9500, 0));
      api.flightFares.length = 0;
      api.flightsDegraded = true;
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("暫時無法取得即時票價");
      expect(screen.queryByText("這條路線暫時沒有可比較的日期。")).toBeNull();
      api.flightsDegraded = false;
      api.flightFares.splice(0, api.flightFares.length, ...fares);
      fireEvent.click(within(alert).getByRole("button", { name: "再試一次" }));
      expect(await screen.findByRole("region", { name: "挑個好日子起飛" })).toBeVisible();
    });

    it("says so when the dates cannot be priced, and retries a failed search", async () => {
      const { api } = renderApp({ path: "/travel", cookieUser: user });
      api.flightHighlights.push(card("NRT", 9500, 0));
      api.flightFares.length = 0;
      api.failNext("POST /api/v1/flights/search");
      const alert = await screen.findByRole("alert");
      expect(alert).toBeVisible();
      fireEvent.click(within(alert).getByRole("button", { name: "再試一次" }));
      expect(await screen.findByText("這條路線暫時沒有可比較的日期。")).toBeVisible();
      expect(screen.queryByRole("link", { name: /等你挑一班/ })).toBeNull();
    });
  });
});
