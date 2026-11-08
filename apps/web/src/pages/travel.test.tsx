import {
  flightSearchRequestSchema,
  googleFlightsUrl,
  taiwanDate,
  type FlightCard,
  type FlightSearchIntent,
} from "@split/shared";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderApp } from "../../test/render-app.js";
import { makeUser } from "../../test/fake-api.js";
import { openSearchPanel } from "../../test/flight-panel.js";

const warmIsland: FlightSearchIntent = {
  origin: "TPE",
  destination: "OKA",
  theme: "warm_island",
  departureDate: "2027-01-08",
  returnDate: "2027-01-11",
  currency: "TWD",
  budget: 15000,
  excludeRedEye: true,
  directOnly: false,
};

/** Runs a prompt search the way a User does; the fake API answers with the Warm island intent. */
async function explore(
  api: { flightPromptIntent: FlightSearchIntent | null },
  language: "en" | "zh-TW",
) {
  api.flightPromptIntent = warmIsland;
  fireEvent.change(
    await screen.findByLabelText(language === "en" ? "Where would you like to go?" : "想去哪裡？"),
    {
      target: { value: "warm island" },
    },
  );
  fireEvent.click(
    screen.getByRole("button", { name: language === "en" ? "Explore flights" : "探索航班" }),
  );
  await screen.findByText("Example Air");
}

describe("Flight Radar", () => {
  it("opens from both Travel links and redirects the old Rich Menu address", async () => {
    const { router } = renderApp({ path: "/trips/latest", cookieUser: makeUser("Rick") });
    expect(await screen.findByRole("heading", { name: "下一站，沖繩！" })).toBeVisible();
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
    expect(await screen.findByRole("heading", { name: "Next stop, Okinawa!" })).toBeVisible();
    await openSearchPanel();
    fireEvent.change(screen.getByLabelText("Destination airport"), { target: { value: "NRT" } });
    fireEvent.change(screen.getByLabelText("Departure date"), { target: { value: "2027-01-08" } });
    fireEvent.change(screen.getByLabelText("Return date"), { target: { value: "2027-01-11" } });
    fireEvent.click(screen.getByRole("button", { name: "Search flights" }));
    expect(await screen.findByText("US$ 250.00")).toBeVisible();
    expect(screen.getByText("Strong Buy")).toBeVisible();
    expect(screen.getByText("Example Air")).toBeVisible();
    expect(screen.getByRole("link", { name: /Example Air/ }).getAttribute("href")).toContain(
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
    await screen.findByRole("heading", { name: "下一站，沖繩！" });
    await openSearchPanel();
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
    // After a search the highlights sit below the results, so find the region again.
    fireEvent.click(
      within(screen.getByRole("region", { name: "Today's Strong Buy fares" })).getByRole("button", {
        name: /TPE → NRT/,
      }),
    );
    expect(
      await screen.findByText("20% below the rolling average · 14 observed days"),
    ).toBeVisible();
    expect(screen.getByText("Price percentile: 7")).toBeVisible();
  });
  it("mixes the last result with a Soul Prompt and edits Entity Pills without another prompt parse", async () => {
    const { api } = renderApp({ path: "/travel", cookieUser: makeUser("Rick") });
    await explore(api, "zh-TW");
    fireEvent.change(screen.getByLabelText("想去哪裡？"), {
      target: { value: "下個月週末四天，一萬五以內不要紅眼" },
    });
    fireEvent.click(screen.getByRole("button", { name: "探索航班" }));
    const pills = await screen.findByRole("region", { name: "目前搜尋條件" });
    expect(
      await within(screen.getByRole("region", { name: "搜尋摘要" })).findByText(
        "1/8（五）– 1/11（一）・1 位成人",
      ),
    ).toBeVisible();
    fireEvent.click(within(pills).getByRole("button", { name: "移除預算上限" }));
    await waitFor(() => {
      expect(api.requests.filter((r) => r.route === "POST /api/v1/flights/search")).toHaveLength(3);
    });
    const requests = api.requests
      .filter((r) => r.route === "POST /api/v1/flights/search")
      .map((r) => flightSearchRequestSchema.parse(JSON.parse(r.body ?? "{}")));
    expect(requests[1]).toMatchObject({
      prompt: "下個月週末四天，一萬五以內不要紅眼",
      defaults: { theme: "warm_island" },
    });
    expect(requests[2]).not.toHaveProperty("prompt");
    expect(requests[2]).not.toHaveProperty("budget");
    expect(requests[2]).toMatchObject({
      departureDate: "2027-01-08",
      returnDate: "2027-01-11",
      excludeRedEye: true,
    });
  });
  it("summarises the search in pills and edits the route in a panel that opens and closes", async () => {
    const { api } = renderApp({
      path: "/travel",
      cookieUser: { ...makeUser("Rick"), language: "en" },
    });
    // The prompt bar comes first; the panel is closed until a pill is tapped.
    const prompt = await screen.findByLabelText("Where would you like to go?");
    const pills = screen.getByRole("region", { name: "Search summary" });
    expect(prompt.compareDocumentPosition(pills) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("form", { name: "Edit search condition" })).toBeNull();
    await explore(api, "en");
    const route = within(pills).getByRole("button", { name: "Edit" });
    expect(route).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(route);
    expect(route).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(route);
    expect(screen.queryByRole("form", { name: "Edit search condition" })).toBeNull();
    fireEvent.click(route);
    const panel = screen.getByRole("form", { name: "Edit search condition" });
    fireEvent.change(within(panel).getByLabelText("Origin airport"), { target: { value: "KHH" } });
    fireEvent.click(screen.getByRole("button", { name: "Search flights" }));
    await waitFor(() => {
      expect(api.requests.filter((r) => r.route === "POST /api/v1/flights/search")).toHaveLength(2);
    });
    expect(screen.queryByRole("form", { name: "Edit search condition" })).toBeNull();
    const requests = api.requests
      .filter((r) => r.route === "POST /api/v1/flights/search")
      .map((r) => flightSearchRequestSchema.parse(JSON.parse(r.body ?? "{}")));
    expect(requests[1]).toMatchObject({ origin: "KHH", theme: "warm_island" });
    expect(requests[1]).not.toHaveProperty("prompt");
  });
  it.each([
    ["en", "Last search", "Edit", "Search flights"],
    ["zh-TW", "上次搜尋", "修改", "搜尋航班"],
  ] as const)(
    "restores the last search in %s without searching, until a new search runs",
    async (language, label, route, search) => {
      const user = { ...makeUser("Rick"), language };
      const first = renderApp({ path: "/travel", cookieUser: user });
      await explore(first.api, language);
      expect(screen.queryByText(label)).toBeNull();
      cleanup();

      const { api } = renderApp({ path: "/travel", cookieUser: user });
      const pills = await screen.findByRole("region", {
        name: /^(Search summary|搜尋摘要)$/,
      });
      expect(await within(pills).findByRole("button", { name: route })).toBeVisible();
      expect(screen.getByText(label)).toBeVisible();
      fireEvent.click(within(pills).getByRole("button", { name: route }));
      expect(screen.getByLabelText(/^(Destination airport|目的地機場)$/)).toHaveValue(
        language === "en" ? "Okinawa (OKA)" : "沖繩 (OKA)",
      );
      expect(api.requests.some((r) => r.route === "POST /api/v1/flights/search")).toBe(false);

      fireEvent.click(screen.getByRole("button", { name: search }));
      await screen.findByText("Example Air");
      expect(screen.queryByText(label)).toBeNull();
    },
  );

  it.each([
    ["en", "Search bar", "Search flights", "Destination airport"],
    ["zh-TW", "搜尋列", "搜尋航班", "目的地機場"],
  ] as const)(
    "keeps Search in a bottom bar in %s only while the panel is open and searches the displayed intent",
    async (language, barName, searchName, destinationName) => {
      const { api } = renderApp({
        path: "/travel",
        cookieUser: { ...makeUser("Rick"), language },
      });
      await screen.findByRole("heading", { name: /^(Next stop, Okinawa!|下一站，沖繩！)$/ });
      expect(screen.queryByRole("region", { name: barName })).toBeNull();
      // Only the route card's own one-tap search exists until the panel opens.
      expect(screen.queryByRole("button", { name: searchName })).toBeNull();
      expect(screen.getAllByRole("button", { name: /^(Search again|重新探索航班)$/ })).toHaveLength(
        1,
      );

      await openSearchPanel();
      const bar = screen.getByRole("region", { name: barName });
      const search = within(bar).getByRole("button", { name: searchName });
      expect(search).toBeEnabled();
      expect(
        screen.getByRole("form", { name: /^(Edit search condition|修改搜尋條件)$/ }),
      ).toBeVisible();

      const destination = screen.getByRole("combobox", { name: destinationName });
      fireEvent.focus(destination);
      fireEvent.change(destination, { target: { value: "NRT" } });
      fireEvent.click(await screen.findByRole("option", { name: /NRT/ }));
      fireEvent.click(search);
      await screen.findByText("Example Air");
      const sent = api.requests
        .filter((r) => r.route === "POST /api/v1/flights/search")
        .map((r) => JSON.parse(r.body ?? "{}") as Record<string, unknown>);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ destination: "NRT" });
      expect(screen.queryByRole("region", { name: barName })).toBeNull();
    },
  );

  it("rejects a past departure date in the calendar and in the search", async () => {
    const { api } = renderApp({
      path: "/travel",
      cookieUser: { ...makeUser("Rick"), language: "en" },
    });
    await openSearchPanel();
    const departure = screen.getByLabelText("Departure date");
    expect(departure).toHaveAttribute("min", taiwanDate(Date.now()));
    fireEvent.change(departure, { target: { value: "2020-01-01" } });
    fireEvent.change(screen.getByLabelText("Return date"), { target: { value: "2020-01-05" } });
    fireEvent.click(screen.getByRole("button", { name: "Search flights" }));
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(api.requests.some((r) => r.route === "POST /api/v1/flights/search")).toBe(false);
  });

  describe("when the browser blocks flight storage", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });
    it("still opens, picks airports and searches without remembering anything", async () => {
      const blocked = (key: string) => key.startsWith("split.flight");
      // The originals are called back with their own `this` below.
      /* eslint-disable @typescript-eslint/unbound-method */
      const getItem = Storage.prototype.getItem;
      const setItem = Storage.prototype.setItem;
      /* eslint-enable @typescript-eslint/unbound-method */
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key) {
        if (blocked(key)) throw new DOMException("blocked", "SecurityError");
        return getItem.call(this, key);
      });
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
        this: Storage,
        key,
        value,
      ) {
        if (blocked(key)) throw new DOMException("blocked", "SecurityError");
        setItem.call(this, key, value);
      });
      const { api } = renderApp({
        path: "/travel",
        cookieUser: { ...makeUser("Rick"), language: "en" },
      });
      await openSearchPanel();
      const destination = screen.getByRole("combobox", { name: "Destination airport" });
      fireEvent.focus(destination);
      expect(within(screen.getByRole("listbox")).getAllByRole("option").length).toBeGreaterThan(0);
      fireEvent.change(destination, { target: { value: "KIX" } });
      fireEvent.click(screen.getByRole("button", { name: "Search flights" }));
      expect(await screen.findByText("Example Air")).toBeVisible();
      expect(api.requests.filter((r) => r.route === "POST /api/v1/flights/search")).toHaveLength(1);
    });
  });

  describe("on Taiwan's calendar", () => {
    afterEach(() => {
      vi.useRealTimers();
    });
    it("treats the Taiwan date as today when UTC is still the day before", async () => {
      // 2026-12-03T17:00Z is 2026-12-04 01:00 in Taiwan.
      vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-12-03T17:00:00Z") });
      const { api } = renderApp({
        path: "/travel",
        cookieUser: { ...makeUser("Rick"), language: "en" },
      });
      await openSearchPanel();
      const departure = screen.getByLabelText("Departure date");
      expect(departure).toHaveAttribute("min", "2026-12-04");
      fireEvent.change(departure, { target: { value: "2026-12-03" } });
      fireEvent.change(screen.getByLabelText("Return date"), { target: { value: "2026-12-06" } });
      fireEvent.click(screen.getByRole("button", { name: "Search flights" }));
      expect(await screen.findByRole("alert")).toBeVisible();
      expect(api.requests.some((r) => r.route === "POST /api/v1/flights/search")).toBe(false);
    });
  });

  it("no longer shows the Vibe Recipe deck", async () => {
    renderApp({ path: "/travel", cookieUser: { ...makeUser("Rick"), language: "en" } });
    await screen.findByRole("heading", { name: "Next stop, Okinawa!" });
    expect(screen.queryByRole("region", { name: "Vibe Recipes" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Warm island" })).toBeNull();
  });

  it("renders fares immediately, then reveals commentary and Adaptive Next-Move Chips", async () => {
    const { api } = renderApp({
      path: "/travel",
      cookieUser: { ...makeUser("Rick"), language: "en" },
    });
    const release = api.holdResponses("POST /api/v1/flights/advise");
    await explore(api, "en");
    expect(await screen.findByText("Example Air")).toBeVisible();
    expect(screen.getByRole("link", { name: /Example Air/ })).toBeVisible();
    await waitFor(() => {
      expect(api.requests.some((r) => r.route === "POST /api/v1/flights/advise")).toBe(true);
    });
    expect(screen.queryByRole("region", { name: "Deal commentary" })).toBeNull();
    release();
    const advice = await screen.findByRole("region", { name: "Deal commentary" });
    expect(within(advice).getByText("Example Air is the cheapest option.")).toBeVisible();
    expect(
      within(screen.getByRole("region", { name: "Ideas to try" }))
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Leave Thursday 2027-01-07", "Allow stops", "One week later"]);
    const request = api.requests.find((r) => r.route === "POST /api/v1/flights/advise");
    expect(JSON.parse(request?.body ?? "{}")).toMatchObject({
      language: "en",
      cards: [{ airline: "Example Air", price: 25000 }],
    });
  });

  it("applies a chip's intent patch to the pills and searches directly without a prompt parse", async () => {
    const { api } = renderApp({
      path: "/travel",
      cookieUser: { ...makeUser("Rick"), language: "en" },
    });
    await explore(api, "en");
    const ideas = await screen.findByRole("region", { name: "Ideas to try" });
    fireEvent.click(within(ideas).getByRole("button", { name: "Leave Thursday 2027-01-07" }));
    expect(
      await within(screen.getByRole("region", { name: "Search summary" })).findByText(
        "Jan 7 – Jan 10 · 1 adult",
      ),
    ).toBeVisible();
    await waitFor(() => {
      expect(api.requests.filter((r) => r.route === "POST /api/v1/flights/search")).toHaveLength(2);
    });
    const searches = api.requests
      .filter((r) => r.route === "POST /api/v1/flights/search")
      .map((r) => flightSearchRequestSchema.parse(JSON.parse(r.body ?? "{}")));
    expect(searches[1]).toMatchObject({
      departureDate: "2027-01-07",
      returnDate: "2027-01-10",
      theme: "warm_island",
    });
    expect(searches[1]).not.toHaveProperty("prompt");
  });

  it("keeps fares and shows no error when advice fails", async () => {
    const { api } = renderApp({
      path: "/travel",
      cookieUser: { ...makeUser("Rick"), language: "en" },
    });
    api.failNext("POST /api/v1/flights/advise", "INTERNAL", 500);
    await explore(api, "en");
    expect(await screen.findByText("Example Air")).toBeVisible();
    await waitFor(() => {
      expect(api.requests.some((r) => r.route === "POST /api/v1/flights/advise")).toBe(true);
    });
    expect(screen.queryByRole("region", { name: "Deal commentary" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("runs the search carried by the LINE portal link without parsing a prompt", async () => {
    const query = new URLSearchParams({
      origin: "TPE",
      destination: "NRT",
      departureDate: "2027-01-08",
      returnDate: "2027-01-11",
      currency: "TWD",
      budget: "15000",
      excludeRedEye: "1",
      directOnly: "0",
    });
    const { api } = renderApp({
      path: `/travel?${query.toString()}`,
      cookieUser: makeUser("Rick"),
    });

    expect(await screen.findByRole("link", { name: /Example Air/ })).toBeVisible();
    const requests = api.requests.filter((r) => r.route === "POST /api/v1/flights/search");
    expect(requests).toHaveLength(1);
    const body: unknown = JSON.parse(requests[0]?.body ?? "{}");
    expect(body).toMatchObject({
      origin: "TPE",
      destination: "NRT",
      departureDate: "2027-01-08",
      returnDate: "2027-01-11",
      budget: 15000,
      excludeRedEye: true,
      directOnly: false,
    });
    expect(body).not.toHaveProperty("prompt");
  });

  it("ignores a malformed portal link and shows the starter view", async () => {
    const { api } = renderApp({
      path: "/travel?destination=nowhere&departureDate=soon",
      cookieUser: makeUser("Rick"),
    });

    expect(await screen.findByRole("heading", { name: "下一站，沖繩！" })).toBeVisible();
    expect(api.requests.some((r) => r.route === "POST /api/v1/flights/search")).toBe(false);
  });
});
