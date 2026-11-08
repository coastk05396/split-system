import type { FlightSearchIntent } from "@split/shared";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
    section: "Pick a good day to fly",
    searchBar: "Search bar",
    fares: "Fares",
    cheaper: "NT$ 4,000 cheaper than Jan 8. Leaving another day saves money.",
    pricier: "NT$ 5,000 pricier than Jan 8.",
    same: "This is the date you searched.",
    lowest: "Lowest",
    selected: "Selected",
    early: "Jan 7 · NT$ 21,000",
    start: "Jan 8 · NT$ 25,000",
    late: "Jan 9 · NT$ 30,000",
  },
  "zh-TW": {
    prompt: "想去哪裡？",
    explore: "探索航班",
    section: "挑個好日子起飛",
    searchBar: "搜尋列",
    fares: "票價選項",
    cheaper: "比 1/8 省 NT$ 4,000，換個日子更划算。",
    pricier: "比 1/8 貴 NT$ 5,000。",
    same: "這是你搜尋的日期。",
    lowest: "最低",
    selected: "已選",
    early: "1/7（四） · NT$ 21,000",
    start: "1/8（五） · NT$ 25,000",
    late: "1/9（六） · NT$ 30,000",
  },
} as const;

type Language = keyof typeof text;

function setup(language: Language, fares = threeDays, intent = exact) {
  const app = renderApp({ path: "/travel/flights", cookieUser: { ...makeUser("Rick"), language } });
  app.api.flightFares = fares;
  app.api.flightPromptIntent = intent;
  return app;
}

async function explore(language: Language) {
  fireEvent.change(await screen.findByLabelText(text[language].prompt), {
    target: { value: "okinawa" },
  });
  fireEvent.click(screen.getByRole("button", { name: text[language].explore }));
  return screen.findByRole("region", { name: text[language].section });
}

const shownAirlines = (language: Language) =>
  within(screen.getByRole("list", { name: text[language].fares }))
    .getAllByRole("listitem")
    .map((row) => within(row).getByText(/Air$/).textContent);

/** The tile whose name starts with the date and price, whatever labels follow. */
const tile = (section: HTMLElement, name: string) =>
  within(section).getByRole("button", { name: (accessible) => accessible.startsWith(name) });

describe("Flight Radar date tiles", () => {
  it.each(["en", "zh-TW"] as const)(
    "shows a tile per priced date with its full price, opened on the searched date in %s",
    async (language) => {
      const t = text[language];
      setup(language);
      const section = await explore(language);
      expect(within(section).getAllByRole("button")).toHaveLength(3);
      expect(within(section).getByText("21,000")).toBeVisible();
      expect(within(section).getByText("25,000")).toBeVisible();
      expect(within(section).getByText("30,000")).toBeVisible();
      expect(tile(section, t.start)).toHaveAttribute("aria-pressed", "true");
      expect(tile(section, t.early)).toHaveAttribute("aria-pressed", "false");
      expect(shownAirlines(language)).toEqual(["Start Air"]);
      // A card in the page flow, not a bar fixed to the screen; no strip left behind.
      expect(section.closest(".fixed")).toBeNull();
      expect(screen.queryByRole("slider")).toBeNull();
      expect(screen.queryByRole("region", { name: t.searchBar })).toBeNull();
    },
  );

  it.each(["en", "zh-TW"] as const)(
    "names each tile with its date, price and label, 最低 only on the cheapest in %s",
    async (language) => {
      const t = text[language];
      setup(language);
      const section = await explore(language);
      expect(tile(section, t.start)).toHaveAccessibleName(`${t.start} · ${t.selected}`);
      expect(tile(section, t.early)).toHaveAccessibleName(`${t.early} · ${t.lowest}`);
      expect(tile(section, t.late)).toHaveAccessibleName(t.late);
      expect(within(section).getAllByText(t.lowest)).toHaveLength(1);
      expect(within(section).getAllByText(t.selected)).toHaveLength(1);
    },
  );

  it.each(["en", "zh-TW"] as const)(
    "switches the list to a tapped date and moves the labels in %s",
    async (language) => {
      const t = text[language];
      setup(language);
      const section = await explore(language);
      fireEvent.click(tile(section, t.early));
      expect(tile(section, t.early)).toHaveAttribute("aria-pressed", "true");
      expect(tile(section, t.start)).toHaveAttribute("aria-pressed", "false");
      expect(shownAirlines(language)).toEqual(["Cheapest Early Air", "Early Air"]);
      // The cheapest tile keeps its 最低 label and gains 已選.
      expect(tile(section, t.early)).toHaveAccessibleName(
        `${t.early} · ${t.selected} · ${t.lowest}`,
      );
      fireEvent.click(tile(section, t.late));
      expect(shownAirlines(language)).toEqual(["Late Air"]);
      expect(within(section).getAllByText(t.selected)).toHaveLength(1);
    },
  );

  it("marks every cheapest date on a tie", async () => {
    setup("en", [
      fare("A Air", 20000, "2027-01-07", "2027-01-10"),
      fare("B Air", 25000, "2027-01-08", "2027-01-11"),
      fare("C Air", 20000, "2027-01-09", "2027-01-12"),
    ]);
    const section = await explore("en");
    expect(within(section).getAllByText("Lowest")).toHaveLength(2);
  });

  it.each(["en", "zh-TW"] as const)(
    "keeps one comparison line in the live region that follows the selection in %s",
    async (language) => {
      const t = text[language];
      setup(language);
      const section = await explore(language);
      const note = within(section).getByRole("status");
      expect(note).toHaveTextContent(t.same);
      fireEvent.click(tile(section, t.early));
      expect(within(section).getByRole("status")).toBe(note);
      expect(note).toHaveTextContent(t.cheaper);
      fireEvent.click(tile(section, t.late));
      expect(note).toHaveTextContent(t.pricier);
      fireEvent.click(tile(section, t.start));
      expect(note).toHaveTextContent(t.same);
      // Persistent: still there after the old 2.2 s note would have gone.
      await new Promise((resolve) => setTimeout(resolve, 2500));
      expect(note).toHaveTextContent(t.same);
    },
  );

  it("compares nothing when the searched date was not priced", async () => {
    setup("en", [
      fare("A Air", 20000, "2027-01-09", "2027-01-12"),
      fare("B Air", 25000, "2027-01-10", "2027-01-13"),
    ]);
    const section = await explore("en");
    expect(within(section).getByRole("status")).toBeEmptyDOMElement();
  });

  it("scrolls the tile row sideways beyond five tiles, five fitting the width", async () => {
    setup(
      "en",
      [5, 6, 7, 8, 9, 10, 11].map((day) =>
        fare(
          `Day${String(day)} Air`,
          20000 + day * 100,
          `2027-01-${String(day).padStart(2, "0")}`,
          "2027-01-15",
        ),
      ),
      { ...exact, departureDate: "2027-01-08" },
    );
    const section = await explore("en");
    const row = within(section).getAllByRole("button")[0]?.parentElement;
    expect(within(section).getAllByRole("button")).toHaveLength(7);
    expect(row).toHaveClass("overflow-x-auto");
    expect(within(section).getAllByRole("button")[0]).toHaveClass("min-w-[calc((100%-2rem)/5)]");
  });

  it.each(["en", "zh-TW"] as const)(
    "has no legend, hint, ghost finger or jump button, and 44 px tiles in %s",
    async (language) => {
      const t = text[language];
      setup(language);
      const section = await explore(language);
      expect(section.querySelector("[data-ghost]")).toBeNull();
      expect(screen.queryByRole("button", { name: /Jump to lowest|跳到最低/ })).toBeNull();
      for (const button of within(section).getAllByRole("button"))
        expect(button).toHaveClass("h-[104px]");
      expect(tile(section, t.late)).toHaveClass("rounded-[18px]");
    },
  );

  it.each(["en", "zh-TW"] as const)(
    "gives the lowest tile an amber look and the selected one an outline in %s",
    async (language) => {
      const t = text[language];
      setup(language);
      const section = await explore(language);
      expect(tile(section, t.early)).toHaveAttribute("data-lowest", "true");
      expect(tile(section, t.start)).not.toHaveAttribute("data-lowest");
      expect(tile(section, t.start)).toHaveClass("border-[3px]");
    },
  );

  it.each(["en", "zh-TW"] as const)(
    "shows no tiles for a single priced date or a theme search in %s",
    async (language) => {
      setup(language, [fare("Start Air", 25000, "2027-01-08", "2027-01-11")]);
      fireEvent.change(await screen.findByLabelText(text[language].prompt), {
        target: { value: "okinawa" },
      });
      fireEvent.click(screen.getByRole("button", { name: text[language].explore }));
      expect(await screen.findByText("Start Air")).toBeVisible();
      expect(screen.queryByRole("region", { name: text[language].section })).toBeNull();
    },
  );

  it("shows no tiles for a theme search even when its cards span dates", async () => {
    setup("en", threeDays, { ...exact, theme: "warm_island" });
    fireEvent.change(await screen.findByLabelText(text.en.prompt), { target: { value: "warm" } });
    fireEvent.click(screen.getByRole("button", { name: text.en.explore }));
    expect(await screen.findByText("Start Air")).toBeVisible();
    expect(screen.queryByRole("region", { name: text.en.section })).toBeNull();
  });

  it("puts one line of advice directly under the tiles, before the list", async () => {
    setup("en");
    const section = await explore("en");
    const advice = await screen.findByRole("region", { name: "Deal commentary" });
    expect(section.compareDocumentPosition(advice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(advice.className).not.toMatch(/surface-card|border/);
    const list = screen.getByRole("list", { name: text.en.fares });
    expect(advice.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("gives the bottom bar to Search while the panel is open and back to the tiles after", async () => {
    const { api } = setup("en");
    await explore("en");
    await openSearchPanel();
    expect(screen.queryByRole("region", { name: text.en.section })).toBeNull();
    expect(screen.getByRole("region", { name: text.en.searchBar })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Search flights" }));
    expect(await screen.findByRole("region", { name: text.en.section })).toBeVisible();
    expect(api.calls.filter((call) => call === "POST /api/v1/flights/search")).toHaveLength(2);
  });

  it("restarts from the new search's own date after another search", async () => {
    const { api } = setup("en");
    const section = await explore("en");
    fireEvent.click(tile(section, text.en.early));
    api.flightFares = [
      fare("Only Air", 20000, "2027-01-08", "2027-01-11"),
      fare("Next Air", 26000, "2027-01-09", "2027-01-12"),
    ];
    fireEvent.change(screen.getByLabelText(text.en.prompt), { target: { value: "again" } });
    fireEvent.click(screen.getByRole("button", { name: text.en.explore }));
    await waitFor(() => {
      expect(
        within(screen.getByRole("region", { name: text.en.section })).getAllByRole("button"),
      ).toHaveLength(2);
    });
    expect(shownAirlines("en")).toEqual(["Only Air"]);
    expect(
      tile(screen.getByRole("region", { name: text.en.section }), "Jan 8 · NT$ 20,000"),
    ).toHaveAttribute("aria-pressed", "true");
  });
});
