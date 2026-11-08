import type { FlightSearchIntent } from "@split/shared";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderApp } from "../../test/render-app.js";
import { makeUser, type FakeApi } from "../../test/fake-api.js";

const warmIsland: FlightSearchIntent = {
  origin: "TPE",
  destination: "OKA",
  theme: "warm_island",
  departureDate: "2027-01-08",
  returnDate: "2027-01-11",
  currency: "TWD",
  excludeRedEye: false,
  directOnly: false,
};

const fare = (airline: string, price: number) => ({
  price,
  airline,
  outboundDeparture: "08:00",
  outboundArrival: "12:00",
  inboundDeparture: "18:00",
  inboundArrival: "20:00",
  stops: 0,
  durationMinutes: 180,
  priceLevel: "low" as const,
});

const text = {
  en: {
    prompt: "Where would you like to go?",
    explore: "Explore flights",
    fares: "Fares",
    pages: "Fare pages",
    page: (n: number, of: number) => `Fare ${String(n)} of ${String(of)}`,
    results: "Search results",
    advice: "Deal commentary",
    price: "NT$ 25,000",
    top: "Top",
    cheapest: "Cheapest",
    sort: "Sort fares",
    caption: "Round-trip total · 1 adult",
    dates: "Jan 8 – Jan 11",
    subtitle: "One adult · round-trip economy, in your Preferred currency.",
    watch: "Price Watch",
  },
  "zh-TW": {
    prompt: "想去哪裡？",
    explore: "探索航班",
    fares: "票價選項",
    pages: "票價分頁",
    page: (n: number, of: number) => `第 ${String(n)} / ${String(of)} 個票價`,
    results: "搜尋結果",
    advice: "票價短評",
    price: "NT$ 25,000",
    top: "熱門",
    cheapest: "最低價",
    sort: "排序方式",
    caption: "來回總價・1 位成人",
    dates: "1/8（五）– 1/11（一）",
    subtitle: "一位成人・來回經濟艙，票價以偏好幣別顯示。",
    watch: "降價叫醒我",
  },
} as const;

type Language = keyof typeof text;

function setup(language: Language, fares = [fare("Example Air", 25000)]) {
  const app = renderApp({ path: "/travel", cookieUser: { ...makeUser("Rick"), language } });
  app.api.flightFares = fares;
  return app;
}

/** Runs a prompt search the way a User does; the fake API answers with the Warm island intent. */
async function explore(api: FakeApi, language: Language) {
  api.flightPromptIntent = warmIsland;
  fireEvent.change(await screen.findByLabelText(text[language].prompt), {
    target: { value: "warm island" },
  });
  fireEvent.click(screen.getByRole("button", { name: text[language].explore }));
}

const threeFares = [
  fare("Example Air", 25000),
  fare("Second Air", 21000),
  fare("Third Air", 30000),
];

/** The device does not ask for reduced motion (the test setup says it does). */
const original = window.matchMedia.bind(window);
function allowMotion() {
  window.matchMedia = (query) => ({ matches: false, media: query }) as MediaQueryList;
}

describe("Flight Radar fare carousel", () => {
  afterEach(() => {
    window.matchMedia = original;
  });

  it.each(["en", "zh-TW"] as const)(
    "shows every fare in a carousel with page dots in %s",
    async (language) => {
      const { api } = setup(language, threeFares);
      await explore(api, language);
      const carousel = await screen.findByRole("group", { name: text[language].fares });
      expect(carousel).toHaveAttribute("tabindex", "0");
      const cards = within(carousel).getAllByRole("article");
      expect(cards.map((card) => within(card).getByText(/Air$/).textContent)).toEqual([
        "Second Air",
        "Example Air",
        "Third Air",
      ]);
      const dots = within(screen.getByRole("group", { name: text[language].pages })).getAllByRole(
        "button",
      );
      expect(dots.map((dot) => dot.getAttribute("aria-label"))).toEqual([
        text[language].page(1, 3),
        text[language].page(2, 3),
        text[language].page(3, 3),
      ]);
      expect(dots[0]).toHaveAttribute("aria-current", "true");
      fireEvent.click(dots[2] as HTMLElement);
      expect(dots[2]).toHaveAttribute("aria-current", "true");
      expect(dots[0]).not.toHaveAttribute("aria-current");
      expect(vi.spyOn(Element.prototype, "scrollIntoView").mock.contexts.at(-1)).toBe(cards[2]);
    },
  );

  it.each(["en", "zh-TW"] as const)(
    "shows no page dots for a single fare in %s",
    async (language) => {
      const { api } = setup(language);
      await explore(api, language);
      expect(await screen.findByText("Example Air")).toBeVisible();
      expect(screen.queryByRole("group", { name: text[language].pages })).toBeNull();
    },
  );

  it.each(["en", "zh-TW"] as const)(
    "shows one sentence of commentary and no helper hints in %s",
    async (language) => {
      const { api } = setup(language);
      api.flightAdvice.commentary =
        language === "en"
          ? "Example Air is the cheapest option. Prices may rise next week."
          : "樣本航空最便宜。下週價格可能上漲。";
      await explore(api, language);
      const advice = await screen.findByRole("region", { name: text[language].advice });
      expect(
        within(advice).getByText(
          language === "en" ? "Example Air is the cheapest option." : "樣本航空最便宜。",
        ),
      ).toBeVisible();
      expect(within(advice).queryByText(/Prices may rise|下週價格/)).toBeNull();
      expect(screen.queryByText(text[language].subtitle)).toBeNull();
    },
  );

  it.each(["en", "zh-TW"] as const)(
    "shows a skeleton of the cards while searching in %s",
    async (language) => {
      const { api } = setup(language);
      const release = api.holdResponses("POST /api/v1/flights/search");
      await explore(api, language);
      const results = await screen.findByRole("region", { name: text[language].results });
      expect(results).toHaveAttribute("aria-busy", "true");
      expect(within(results).queryByRole("link")).toBeNull();
      expect(within(results).getByRole("status")).toBeVisible();
      release();
      expect(await within(results).findByText("Example Air")).toBeVisible();
      expect(results).not.toHaveAttribute("aria-busy", "true");
    },
  );

  it.each(["en", "zh-TW"] as const)(
    "keeps the empty and degraded states and the Price Watch of a later card in %s",
    async (language) => {
      const { api } = setup(language, threeFares);
      await explore(api, language);
      const carousel = await screen.findByRole("group", { name: text[language].fares });
      const third = within(carousel).getAllByRole("article")[2] as HTMLElement;
      fireEvent.click(within(third).getByRole("button", { name: text[language].watch }));
      expect(await screen.findByRole("dialog", { name: text[language].watch })).toBeVisible();
      expect(within(screen.getByRole("dialog")).getByText(/TPE → OKA/)).toBeVisible();
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
      });

      api.flightFares = [];
      await explore(api, language);
      await waitFor(() => {
        expect(screen.queryByRole("group", { name: text[language].fares })).toBeNull();
      });
      expect(
        await screen.findByRole("link", { name: language === "en" ? "View Flights" : "查看航班" }),
      ).toBeVisible();
    },
  );

  it.each(["en", "zh-TW"] as const)(
    "rolls prices and times only when motion is allowed, keeping the final value readable in %s",
    async (language) => {
      allowMotion();
      const { api } = setup(language);
      await explore(api, language);
      const carousel = await screen.findByRole("group", { name: text[language].fares });
      expect(carousel).toHaveAttribute("data-motion", "full");
      const price = within(carousel).getByText(text[language].price);
      expect(price).toBeVisible();
      const rolling = price.parentElement?.querySelector("[aria-hidden='true']");
      expect(rolling).toHaveAttribute("data-rolling", "true");
      expect(rolling).toHaveTextContent(text[language].price);
    },
  );

  it.each(["en", "zh-TW"] as const)(
    "shows final states with no roll, glide or depth under reduced motion in %s",
    async (language) => {
      const { api } = setup(language);
      await explore(api, language);
      const carousel = await screen.findByRole("group", { name: text[language].fares });
      expect(carousel).toHaveAttribute("data-motion", "reduced");
      const price = within(carousel).getByText(text[language].price);
      expect(price.parentElement?.querySelector("[data-rolling]")).toBeNull();
    },
  );

  const mixed = [
    { ...fare("Plain Air", 18000) },
    { ...fare("Top Dear Air", 30000), top: true },
    { ...fare("Top Mid Air", 26000), top: true },
    { ...fare("Other Air", 22000) },
  ];
  const order = (language: Language) =>
    within(screen.getByRole("group", { name: text[language].fares }))
      .getAllByRole("article")
      .map((card) => within(card).getByText(/Air$/).textContent);

  it.each(["en", "zh-TW"] as const)(
    "lists top fares first, then switches to every fare by price and back in %s",
    async (language) => {
      const { api } = setup(language, mixed);
      await explore(api, language);
      await screen.findByRole("group", { name: text[language].fares });
      const toggle = screen.getByRole("group", { name: text[language].sort });
      const top = within(toggle).getByRole("button", { name: text[language].top });
      const cheapest = within(toggle).getByRole("button", { name: text[language].cheapest });
      expect(top).toHaveAttribute("aria-pressed", "true");
      expect(order(language)).toEqual(["Top Dear Air", "Top Mid Air", "Plain Air", "Other Air"]);
      fireEvent.click(cheapest);
      expect(cheapest).toHaveAttribute("aria-pressed", "true");
      expect(order(language)).toEqual(["Plain Air", "Other Air", "Top Mid Air", "Top Dear Air"]);
      fireEvent.click(top);
      expect(order(language)).toEqual(["Top Dear Air", "Top Mid Air", "Plain Air", "Other Air"]);
    },
  );

  it("treats fares without top as not top, opens on the top view again after a new search", async () => {
    const { api } = setup("en", threeFares);
    await explore(api, "en");
    await screen.findByRole("group", { name: text.en.fares });
    expect(order("en")).toEqual(["Second Air", "Example Air", "Third Air"]);
    fireEvent.click(screen.getByRole("button", { name: text.en.cheapest }));
    await explore(api, "en");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: text.en.top })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
  });

  it.each(["en", "zh-TW"] as const)(
    "captions every card price and shows friendly dates, never ISO ones, in %s",
    async (language) => {
      const { api } = setup(language, threeFares);
      await explore(api, language);
      const carousel = await screen.findByRole("group", { name: text[language].fares });
      const cards = within(carousel).getAllByRole("article");
      for (const card of cards) {
        expect(within(card).getByText(text[language].caption)).toBeVisible();
        expect(within(card).getByText(text[language].dates)).toBeVisible();
      }
      expect(within(carousel).queryByText(/2027-01/)).toBeNull();
    },
  );
});
