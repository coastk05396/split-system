import { googleFlightsUrl, type FlightCard } from "@split/shared";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp } from "../../test/render-app.js";
import { makeUser } from "../../test/fake-api.js";

describe("Flight Radar", () => {
  it("opens from both Travel links and redirects the old Rich Menu address", async () => {
    const { router } = renderApp({ path: "/trips/latest", cookieUser: makeUser("Rick") });
    expect(await screen.findByRole("heading", { name: "航班雷達" })).toBeVisible();
    expect(router.state.location.pathname).toBe("/travel");
    for (const name of ["底部導覽", "側邊導覽"]) {
      expect(
        within(screen.getByRole("navigation", { name })).getByRole("link", { name: "旅遊" }),
      ).toHaveAttribute("href", "/travel");
    }
    expect(screen.queryByText("旅遊功能即將推出，敬請期待！")).toBeNull();
  });
  it("prices an English round trip in the Preferred currency and shows the Google handoff", async () => {
    const { api } = renderApp({
      path: "/travel",
      cookieUser: { ...makeUser("Rick"), language: "en", preferredCurrency: "USD" },
    });
    expect(await screen.findByRole("heading", { name: "Flight Radar" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Destination airport"), { target: { value: "NRT" } });
    fireEvent.change(screen.getByLabelText("Departure date"), { target: { value: "2027-01-08" } });
    fireEvent.change(screen.getByLabelText("Return date"), { target: { value: "2027-01-11" } });
    fireEvent.click(screen.getByRole("button", { name: "Search flights" }));
    expect(await screen.findByText("US$ 250.00")).toBeVisible();
    expect(screen.getByText("Strong Buy")).toBeVisible();
    expect(screen.getByText("Example Air")).toBeVisible();
    expect(screen.getByRole("link", { name: "View Flights" }).getAttribute("href")).toContain(
      "?tfs=",
    );
    const request = api.requests.find((r) => r.route === "POST /api/v1/flights/search");
    expect(JSON.parse(request?.body ?? "{}")).toMatchObject({
      origin: "TPE",
      destination: "NRT",
      currency: "USD",
      departureDate: "2027-01-08",
      returnDate: "2027-01-11",
    });
  });

  it("returns signed-out visitors to Flight Radar after sign-in", async () => {
    const { router } = renderApp({ path: "/travel" });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/sign-in");
    });
    expect(new URLSearchParams(router.state.location.search).get("next")).toBe("/travel");
  });

  it("offers a direct Google link when live pricing is blocked", async () => {
    const { api } = renderApp({ path: "/travel", cookieUser: makeUser("Rick") });
    api.flightsDegraded = true;
    await screen.findByRole("heading", { name: "航班雷達" });
    fireEvent.change(screen.getByLabelText("目的地機場"), { target: { value: "NRT" } });
    fireEvent.change(screen.getByLabelText("出發日期"), { target: { value: "2027-01-08" } });
    fireEvent.change(screen.getByLabelText("回程日期"), { target: { value: "2027-01-11" } });
    fireEvent.click(screen.getByRole("button", { name: "搜尋航班" }));
    expect(
      await screen.findByText("暫時無法取得即時票價，請直接到 Google 航班查看。"),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "查看航班" }).getAttribute("href")).toContain("?tfs=");
  });
  it("runs a verified highlight in one tap and shows history only after 14 observed days", async () => {
    const { api } = renderApp({
      path: "/travel",
      cookieUser: { ...makeUser("Rick"), language: "en", preferredCurrency: "USD" },
    });
    const intent = {
      origin: "TPE",
      destination: "NRT",
      departureDate: "2027-01-08",
      returnDate: "2027-01-11",
      currency: "USD" as const,
      excludeRedEye: false,
      directOnly: false,
    };
    const card: FlightCard = {
      price: 25000,
      airline: "Example Air",
      outboundDeparture: "08:00",
      outboundArrival: "12:00",
      inboundDeparture: null,
      inboundArrival: null,
      stops: 0,
      durationMinutes: 180,
      priceLevel: "low",
      intent,
      signal: "strong_buy",
      overBudget: 0,
      url: googleFlightsUrl(intent),
    };
    api.flightHighlights.push(card);
    api.flightHistory = { days: 13, meanPrice: 31250, percentBelowMean: 20, percentile: 7 };
    const ticker = await screen.findByRole("region", { name: "Today's Strong Buy fares" });
    fireEvent.click(await within(ticker).findByRole("button", { name: /TPE → NRT/ }));
    expect(await screen.findByText("Example Air")).toBeVisible();
    expect(screen.queryByText(/rolling average/)).toBeNull();
    const request = api.requests.find((r) => r.route === "POST /api/v1/flights/search");
    expect(JSON.parse(request?.body ?? "{}")).toEqual(intent);
    expect(api.requests.find((r) => r.route === "GET /api/v1/flights/highlights")).toBeDefined();
    api.flightHistory = { days: 14, meanPrice: 31250, percentBelowMean: 20, percentile: 7 };
    fireEvent.click(within(ticker).getByRole("button", { name: /TPE → NRT/ }));
    expect(
      await screen.findByText("20% below the rolling average · 14 observed days"),
    ).toBeVisible();
    expect(screen.getByText("Price percentile: 7")).toBeVisible();
  });
});
