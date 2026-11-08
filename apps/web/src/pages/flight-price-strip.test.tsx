import type { FlightSearchIntent } from "@split/shared";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { renderApp } from "../../test/render-app.js";
import { makeUser } from "../../test/fake-api.js";
import { openSearchPanel } from "../../test/flight-panel.js";

const exact: FlightSearchIntent = {
  origin: "TPE",
  destination: "OKA",
  departureDate: "2027-01-08",
  returnDate: "2027-01-11",
  currency: "TWD",
  excludeRedEye: false,
  directOnly: false,
};

const fare = (airline: string, price: number, departureDate: string, returnDate: string) => ({
  price,
  airline,
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

/** The requested pair priced with the pair a day earlier and a day later, as the server does. */
const threeDays = [
  fare("Early Air", 24000, "2027-01-07", "2027-01-10"),
  fare("Cheapest Early Air", 21000, "2027-01-07", "2027-01-10"),
  fare("Start Air", 25000, "2027-01-08", "2027-01-11"),
  fare("Late Air", 30000, "2027-01-09", "2027-01-12"),
];

const text = {
  en: {
    prompt: "Where would you like to go?",
    explore: "Explore flights",
    slider: "Departure date",
    bar: "Price Strip",
    searchBar: "Search bar",
    fares: "Fares",
    hint: "Shorter bars are cheaper. Swipe or tap to pick a departure date.",
    cheaper: "▼ NT$ 4,000 cheaper",
    pricier: "▲ NT$ 5,000 pricier",
    startValue: "Jan 8 · NT$ 25,000 · Normal",
    firstValue: "Jan 7 · NT$ 21,000 · Cheap · Lowest",
    lastValue: "Jan 9 · NT$ 30,000 · Pricey",
  },
  "zh-TW": {
    prompt: "想去哪裡？",
    explore: "探索航班",
    slider: "出發日期",
    bar: "價格條",
    searchBar: "搜尋列",
    fares: "票價選項",
    hint: "越矮越便宜，左右滑動或點一下選出發日。",
    cheaper: "▼ 便宜 NT$ 4,000",
    pricier: "▲ 貴 NT$ 5,000",
    startValue: "1/8（五） · NT$ 25,000 · 普通",
    firstValue: "1/7（四） · NT$ 21,000 · 便宜 · 最低",
    lastValue: "1/9（六） · NT$ 30,000 · 偏貴",
  },
} as const;

type Language = keyof typeof text;

function setup(language: Language, fares = threeDays, intent = exact) {
  const app = renderApp({ path: "/travel", cookieUser: { ...makeUser("Rick"), language } });
  app.api.flightFares = fares;
  app.api.flightPromptIntent = intent;
  return app;
}

async function explore(language: Language) {
  fireEvent.change(await screen.findByLabelText(text[language].prompt), {
    target: { value: "okinawa" },
  });
  fireEvent.click(screen.getByRole("button", { name: text[language].explore }));
  return screen.findByRole("slider", { name: text[language].slider });
}

const shownAirlines = (language: Language) =>
  within(screen.getByRole("list", { name: text[language].fares }))
    .getAllByRole("listitem")
    .map((row) => within(row).getByText(/Air$/).textContent);

/** The device does not ask for reduced motion (the test setup says it does). */
const original = window.matchMedia.bind(window);
function allowMotion() {
  window.matchMedia = (query) => ({ matches: false, media: query }) as MediaQueryList;
}

/** jsdom lays nothing out: give the strip a 300px width at the left edge, and pointer capture. */
function layOut(slider: HTMLElement) {
  slider.getBoundingClientRect = () => ({ left: 0, width: 300 }) as DOMRect;
}

describe("Flight Radar Price Strip", () => {
  beforeAll(() => {
    Element.prototype.setPointerCapture = () => undefined;
  });
  afterEach(() => {
    window.matchMedia = original;
  });

  it.each(["en", "zh-TW"] as const)(
    "draws one bar per priced date, starts on the searched date and describes it in %s",
    async (language) => {
      setup(language);
      const slider = await explore(language);
      const strip = screen.getByRole("region", { name: text[language].bar });
      expect(within(strip).getByRole("slider")).toBe(slider);
      expect(slider).toHaveAttribute("aria-valuemin", "0");
      expect(slider).toHaveAttribute("aria-valuemax", "2");
      expect(slider).toHaveAttribute("aria-valuenow", "1");
      expect(slider).toHaveAttribute("aria-valuetext", text[language].startValue);
      // The carousel shows the cards of the selected date only.
      expect(shownAirlines(language)).toEqual(["Start Air"]);
      expect(screen.queryByRole("region", { name: text[language].searchBar })).toBeNull();
      // The strip is a card in the page flow, not a bar fixed to the screen.
      expect(strip.className).not.toMatch(/fixed/);
      expect(strip.closest(".fixed")).toBeNull();
    },
  );

  it.each(["en", "zh-TW"] as const)(
    "puts one line of advice directly under the strip, before the list, in %s",
    async (language) => {
      setup(language);
      await explore(language);
      const strip = screen.getByRole("region", { name: text[language].bar });
      const advice = await screen.findByRole("region", {
        name: language === "en" ? "Deal commentary" : "票價短評",
      });
      expect(strip.compareDocumentPosition(advice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(advice.className).not.toMatch(/surface-card|border/);
      const list = screen.getByRole("list", { name: text[language].fares });
      expect(advice.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    },
  );

  it.each(["en", "zh-TW"] as const)(
    "shows no strip for a single priced date or a theme search in %s",
    async (language) => {
      setup(language, [fare("Start Air", 25000, "2027-01-08", "2027-01-11")]);
      await screen.findByLabelText(text[language].prompt);
      fireEvent.change(screen.getByLabelText(text[language].prompt), {
        target: { value: "okinawa" },
      });
      fireEvent.click(screen.getByRole("button", { name: text[language].explore }));
      expect(await screen.findByText("Start Air")).toBeVisible();
      expect(screen.queryByRole("slider")).toBeNull();
      expect(screen.queryByRole("region", { name: text[language].bar })).toBeNull();
    },
  );

  it("shows no strip for a theme search even when its cards span dates", async () => {
    setup("en", threeDays, { ...exact, theme: "warm_island" });
    await screen.findByLabelText(text.en.prompt);
    fireEvent.change(screen.getByLabelText(text.en.prompt), { target: { value: "warm" } });
    fireEvent.click(screen.getByRole("button", { name: text.en.explore }));
    expect(await screen.findByText("Start Air")).toBeVisible();
    expect(screen.queryByRole("slider")).toBeNull();
  });

  it.each(["en", "zh-TW"] as const)(
    "switches the cards with the arrow keys and shows the difference to the start date in %s",
    async (language) => {
      setup(language);
      const slider = await explore(language);
      slider.focus();
      fireEvent.keyDown(slider, { key: "ArrowLeft" });
      expect(slider).toHaveAttribute("aria-valuenow", "0");
      expect(slider).toHaveAttribute("aria-valuetext", text[language].firstValue);
      expect(shownAirlines(language)).toEqual(["Cheapest Early Air", "Early Air"]);
      expect(await screen.findByText(text[language].cheaper, { exact: false })).toBeVisible();

      fireEvent.keyDown(slider, { key: "ArrowRight" });
      fireEvent.keyDown(slider, { key: "ArrowRight" });
      expect(slider).toHaveAttribute("aria-valuenow", "2");
      expect(slider).toHaveAttribute("aria-valuetext", text[language].lastValue);
      expect(shownAirlines(language)).toEqual(["Late Air"]);
      expect(screen.queryByText(text[language].cheaper)).toBeNull();
      expect(screen.getByText(text[language].pricier)).toBeVisible();

      // Past the last bar it stays put; the label goes away by itself after a couple of seconds.
      fireEvent.keyDown(slider, { key: "ArrowRight" });
      expect(slider).toHaveAttribute("aria-valuenow", "2");
      await waitFor(
        () => {
          expect(screen.queryByText(text[language].pricier)).toBeNull();
        },
        { timeout: 4000 },
      );

      // Back on the start date there is nothing to compare.
      fireEvent.keyDown(slider, { key: "ArrowLeft" });
      expect(slider).toHaveAttribute("aria-valuetext", text[language].startValue);
      expect(screen.queryByText(/NT\$ \d,000 (cheaper|pricier)|便宜 NT|貴 NT/)).toBeNull();
    },
  );

  it("jumps to the first and last date with Home and End", async () => {
    setup("en");
    const slider = await explore("en");
    fireEvent.keyDown(slider, { key: "End" });
    expect(slider).toHaveAttribute("aria-valuenow", "2");
    expect(shownAirlines("en")).toEqual(["Late Air"]);
    fireEvent.keyDown(slider, { key: "Home" });
    expect(slider).toHaveAttribute("aria-valuenow", "0");
    expect(shownAirlines("en")).toEqual(["Cheapest Early Air", "Early Air"]);
  });

  it("switches the cards by tapping and dragging along the strip", async () => {
    setup("en");
    const slider = await explore("en");
    layOut(slider);
    fireEvent.pointerDown(slider, { clientX: 10, pointerId: 1 });
    expect(slider).toHaveAttribute("aria-valuenow", "0");
    expect(shownAirlines("en")).toEqual(["Cheapest Early Air", "Early Air"]);
    fireEvent.pointerMove(slider, { clientX: 150, pointerId: 1 });
    expect(slider).toHaveAttribute("aria-valuenow", "1");
    fireEvent.pointerMove(slider, { clientX: 290, pointerId: 1 });
    expect(slider).toHaveAttribute("aria-valuenow", "2");
    expect(shownAirlines("en")).toEqual(["Late Air"]);
    // A move with no finger down does nothing.
    fireEvent.pointerUp(slider, { pointerId: 1 });
    fireEvent.pointerMove(slider, { clientX: 10, pointerId: 1 });
    expect(slider).toHaveAttribute("aria-valuenow", "2");
  });

  it.each(["en", "zh-TW"] as const)(
    "shows the legend and the ghost finger until the first touch in %s",
    async (language) => {
      allowMotion();
      setup(language);
      const slider = await explore(language);
      const strip = screen.getByRole("region", { name: text[language].bar });
      expect(within(strip).getByText(text[language].hint)).toBeVisible();
      expect(strip.querySelector("[data-ghost]")).not.toBeNull();
      expect(slider).toHaveAttribute("data-motion", "full");
      fireEvent.keyDown(slider, { key: "ArrowLeft" });
      expect(within(strip).queryByText(text[language].hint)).toBeNull();
      expect(strip.querySelector("[data-ghost]")).toBeNull();
    },
  );

  it("has the live note region in place before the first touch, empty until a difference", async () => {
    setup("en");
    const slider = await explore("en");
    const strip = screen.getByRole("region", { name: text.en.bar });
    const note = within(strip).getByRole("status");
    expect(note).toBeEmptyDOMElement();
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(within(strip).getByRole("status")).toBe(note);
    expect(note).toHaveTextContent(text.en.cheaper);
  });

  it("adds Lowest to the live note when the selected date is the lowest", async () => {
    setup("en");
    const slider = await explore("en");
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    const note = within(screen.getByRole("region", { name: text.en.bar })).getByRole("status");
    expect(note).toHaveTextContent(`${text.en.cheaper} · Lowest`);
  });

  it("keeps the legend but draws no ghost finger under reduced motion", async () => {
    setup("en");
    await explore("en");
    const strip = screen.getByRole("region", { name: text.en.bar });
    expect(within(strip).getByText(text.en.hint)).toBeVisible();
    expect(strip.querySelector("[data-ghost]")).toBeNull();
  });

  it("gives the bottom bar to Search while the panel is open and back to the strip after", async () => {
    const { api } = setup("en");
    await explore("en");
    await openSearchPanel();
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.getByRole("region", { name: text.en.searchBar })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Search flights" }));
    expect(await screen.findByRole("slider", { name: text.en.slider })).toBeVisible();
    expect(api.calls.filter((call) => call === "POST /api/v1/flights/search")).toHaveLength(2);
  });

  it("restarts from the new search's own date after another search", async () => {
    const { api } = setup("en");
    const slider = await explore("en");
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    api.flightFares = [
      fare("Only Air", 20000, "2027-01-08", "2027-01-11"),
      fare("Next Air", 26000, "2027-01-09", "2027-01-12"),
    ];
    fireEvent.change(screen.getByLabelText(text.en.prompt), { target: { value: "again" } });
    fireEvent.click(screen.getByRole("button", { name: text.en.explore }));
    await waitFor(() => {
      expect(screen.getByRole("slider")).toHaveAttribute("aria-valuemax", "1");
    });
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "0");
    expect(shownAirlines("en")).toEqual(["Only Air"]);
  });

  it.each(["en", "zh-TW"] as const)(
    "shows the selected bar's price and labels only the cheapest date in %s",
    async (language) => {
      const lowest = language === "en" ? "Lowest" : "最低";
      const slider = (setup(language), await explore(language));
      const strip = screen.getByRole("region", { name: text[language].bar });
      expect(within(strip).getAllByText(lowest)).toHaveLength(1);
      expect(within(strip).getByText("NT$ 25,000")).toBeVisible();
      expect(within(strip).queryByText("NT$ 21,000")).toBeNull();
      fireEvent.keyDown(slider, { key: "ArrowLeft" });
      expect(within(strip).getByText("NT$ 21,000")).toBeVisible();
      expect(within(strip).queryByText("NT$ 25,000")).toBeNull();
      expect(within(strip).getAllByText(lowest)).toHaveLength(1);
    },
  );

  it("labels every cheapest date on a tie", async () => {
    setup("en", [
      fare("A Air", 20000, "2027-01-07", "2027-01-10"),
      fare("B Air", 25000, "2027-01-08", "2027-01-11"),
      fare("C Air", 20000, "2027-01-09", "2027-01-12"),
    ]);
    const slider = await explore("en");
    const strip = screen.getByRole("region", { name: text.en.bar });
    expect(within(strip).getAllByText("Lowest")).toHaveLength(2);
    fireEvent.keyDown(slider, { key: "End" });
    expect(slider).toHaveAttribute("aria-valuetext", "Jan 9 · NT$ 20,000 · Cheap · Lowest");
  });
});
