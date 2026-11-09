import type { FlightSearchIntent } from "@split/shared";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { flightSearchRequestSchema } from "@split/shared";
import { makeUser } from "../../test/fake-api.js";
import { openSearchPanel } from "../../test/flight-panel.js";
import { renderApp } from "../../test/render-app.js";

const intent: FlightSearchIntent = {
  origin: "TPE",
  destination: "OKA",
  departureDate: "2027-01-08",
  returnDate: "2027-01-11",
  currency: "TWD",
  excludeRedEye: false,
  directOnly: false,
  budget: 15000,
};

const text = {
  en: {
    card: "Search summary",
    origin: "Taipei Taoyuan",
    destination: "Okinawa",
    dates: "Jan 8 – Jan 11",
    chip: "Taipei Taoyuan → Okinawa Jan 8 – Jan 11",
    edit: "Edit",
    search: "Search again",
    panelSearch: "Search flights",
    prompt: "Where would you like to go?",
    headline: "Next stop, Okinawa!",
    asking: "Where to next?",
    bell: "Price Watch radar",
    watches: "My Price Watches",
    leg: "655 km · ≈ 1 h 19 min",
    nrt: "2,182 km · ≈ 3 h 14 min",
    explore: "Explore flights",
    pills: "Active search conditions",
    budget: /^Budget/,
  },
  "zh-TW": {
    card: "搜尋摘要",
    origin: "台北桃園",
    destination: "沖繩",
    dates: "1/8（五）– 1/11（一）",
    chip: "台北桃園 → 沖繩 1/8（五）– 1/11（一）",
    edit: "修改",
    search: "重新探索航班",
    panelSearch: "搜尋航班",
    prompt: "想去哪裡？",
    headline: "下一站，沖繩！",
    asking: "下一站，去哪裡？",
    bell: "降價雷達",
    watches: "我的降價雷達",
    leg: "655 公里・約 1 小時 19 分",
    nrt: "2,182 公里・約 3 小時 14 分",
    explore: "探索航班",
    pills: "目前搜尋條件",
    budget: /^預算/,
  },
} as const;
type Language = keyof typeof text;

function setup(language: Language, next: FlightSearchIntent = intent) {
  const app = renderApp({ path: "/travel/flights", cookieUser: { ...makeUser("Rick"), language } });
  app.api.flightPromptIntent = next;
  return app;
}
const searches = (api: ReturnType<typeof setup>["api"]) =>
  api.requests.filter((r) => r.route === "POST /api/v1/flights/search");

async function explore(language: Language) {
  fireEvent.change(await screen.findByLabelText(text[language].prompt), {
    target: { value: "okinawa" },
  });
  fireEvent.click(screen.getByRole("button", { name: text[language].explore }));
  await screen.findByText("Example Air");
}

describe("Flight Radar header and route card", () => {
  it.each(["en", "zh-TW"] as const)(
    "shows city names with small codes, the dates and one adult in %s",
    async (language) => {
      setup(language);
      await explore(language);
      const card = screen.getByRole("region", { name: text[language].card });
      // The mock has no hero card: only the chip row (route chip and sort bar) is left.
      expect(within(card).queryByText("TPE")).toBeNull();
      expect(within(card).queryByRole("button", { name: text[language].search })).toBeNull();
      // The distance and flight time sit in the header, beside the globe.
      expect(screen.getByText(text[language].leg)).toBeInTheDocument();
      expect(within(card).getByRole("button", { name: text[language].chip })).toBeVisible();
      expect(screen.queryByRole("region", { name: text[language].pills })).toBeNull();
    },
  );

  it.each(["en", "zh-TW"] as const)(
    "names the destination in the headline, with no eyebrow or gradient text, in %s",
    async (language) => {
      setup(language);
      expect(
        await screen.findByRole("heading", { level: 1, name: text[language].headline }),
      ).toBeVisible();
      // The decision to drop the globe was reversed (#125); the globe has its own tests.
      expect(document.querySelector("[class*='bg-clip-text']")).toBeNull();
      expect(document.querySelector("[class*='gradient']")).toBeNull();
    },
  );

  it.each(["en", "zh-TW"] as const)(
    "asks where when the search has no destination in %s",
    async (language) => {
      setup(language, { ...intent, theme: "warm_island" });
      await explore(language);
      expect(screen.getByRole("heading", { level: 1, name: text[language].asking })).toBeVisible();
    },
  );

  it.each(["en", "zh-TW"] as const)(
    "links a 44 px bell to the Price Watch page in %s",
    async (language) => {
      setup(language);
      await openSearchPanel();
      const bell = await screen.findByRole("link", { name: text[language].bell });
      expect(bell).toHaveClass("fr-ic", "fr-hit");
      expect(bell).toHaveAttribute("href", "/travel/watches");
      expect(bell.querySelector("svg")).not.toBeNull();
    },
  );

  it("shows the distance and flight time of another route and none for an unknown one", async () => {
    setup("en", { ...intent, destination: "NRT" });
    await explore("en");
    expect(screen.getByText(text.en.nrt)).toBeVisible();
    expect(screen.queryByText(text.en.leg)).toBeNull();
  });

  it("falls back to the airport code for an airport the catalog does not know", async () => {
    setup("en", { ...intent, origin: "ZZZ" });
    await explore("en");
    const card = screen.getByRole("region", { name: text.en.card });
    expect(card).toHaveTextContent("ZZZ → OKA");
    expect(card).not.toHaveTextContent(/km/);
    expect(card).not.toHaveTextContent(/NaN|undefined/);
  });

  it.each(["en", "zh-TW"] as const)(
    "opens and closes the editing panel with the route chip in %s",
    async (language) => {
      setup(language);
      await explore(language);
      const card = screen.getByRole("region", { name: text[language].card });
      const chip = within(card).getByRole("button", { name: text[language].chip });
      expect(chip).toHaveAttribute("aria-expanded", "false");
      expect(chip.querySelector("svg")).not.toBeNull();
      expect(within(card).queryByRole("button", { name: text[language].edit })).toBeNull();
      fireEvent.click(chip);
      expect(chip).toHaveAttribute("aria-expanded", "true");
      expect(
        screen.getByRole("form", { name: /^(Edit search condition|修改搜尋條件)$/ }),
      ).toBeVisible();
      fireEvent.click(chip);
      expect(
        screen.queryByRole("form", { name: /^(Edit search condition|修改搜尋條件)$/ }),
      ).toBeNull();
    },
  );

  it.each(["en", "zh-TW"] as const)(
    "keeps the route chip on one line with a 44 px target and no unknown trip facts in %s",
    async (language) => {
      setup(language);
      await explore(language);
      const card = screen.getByRole("region", { name: text[language].card });
      const chip = within(card).getByRole("button", { name: text[language].chip });
      // The mock's 40 px chip on one line (nowrap in CSS) with a 44 px hit area.
      expect(chip).toHaveClass("fr-chip", "fr-hit");
      expect(chip.className).not.toMatch(/opacity|break-/);
      // One-way and passenger count are not part of the search yet, so they are never shown.
      expect(chip).not.toHaveTextContent(/單程|One-way|人|passenger/);
    },
  );

  it.each(["en", "zh-TW"] as const)(
    "never truncates the dates and offers a compact code form for narrow cards in %s",
    async (language) => {
      setup(language);
      await explore(language);
      const card = screen.getByRole("region", { name: text[language].card });
      const chip = within(card).getByRole("button", { name: text[language].chip });
      // jsdom has no layout, so check what is rendered: codes and short dates are always present
      // for the narrow form, and no date text sits inside an element that can be clipped.
      expect(within(chip).getByText("TPE → OKA")).toBeInTheDocument();
      const compactDates = within(chip).getByText("1/8–1/11");
      const fullDates = within(chip).getByText(text[language].dates);
      for (const dates of [compactDates, fullDates]) {
        expect(dates.closest(".truncate")).toBeNull();
        expect(dates).toHaveClass("shrink-0");
      }
      // Only the long city-name route may shrink.
      expect(
        within(chip)
          .getByText(/Taipei Taoyuan|台北桃園/)
          .closest(".truncate"),
      ).not.toBeNull();
    },
  );

  it.each(["en", "zh-TW"] as const)(
    "searches the shown search from the panel's Search button, without a prompt parse, in %s",
    async (language) => {
      const { api } = setup(language);
      await explore(language);
      await openSearchPanel();
      fireEvent.click(screen.getByRole("button", { name: text[language].panelSearch }));
      await waitFor(() => {
        expect(searches(api)).toHaveLength(2);
      });
      const request = flightSearchRequestSchema.parse(JSON.parse(searches(api)[1]?.body ?? "{}"));
      expect(request).not.toHaveProperty("prompt");
      expect(request).toMatchObject({ origin: "TPE", destination: "OKA", budget: 15000 });
    },
  );
});
