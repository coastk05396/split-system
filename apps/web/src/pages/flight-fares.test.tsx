import type { FlightSearchIntent } from "@split/shared";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderApp } from "../../test/render-app.js";
import { openFilters } from "../../test/flight-panel.js";
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

const fare = (
  airline: string,
  price: number,
  priceLevel: "low" | "typical" | "high" | "unknown" = "low",
) => ({
  price,
  airline,
  outboundDeparture: "08:00",
  outboundArrival: "12:00",
  inboundDeparture: "18:00",
  inboundArrival: "20:00",
  stops: 0,
  durationMinutes: 180,
  priceLevel,
});

const text = {
  en: {
    prompt: "Where would you like to go?",
    explore: "Explore flights",
    fares: "Fares",
    showAll: (n: number) => `Show all ${String(n)} flights`,
    nonstop: "Nonstop",
    results: "Search results",
    advice: "Deal commentary",
    price: "NT$ 25,000",
    highlights: "Today's Strong Buy fares",
    ideas: "Ideas to try",
    top: "Top",
    sticker: "Strong Buy",
    cheapest: "Cheapest",
    sort: "Sort fares",
    footnote:
      "Prices are round-trip totals for 1 adult from Google Flights. Check again before you book.",
    title: "Find your flight",
    order: "Cheapest first",
    meta: "Nonstop · 3 h",
    oneStop: "1 stop · 3 h 10 min",
    bell: "Price Watch",
    subtitle: "One adult · round-trip economy, in your Preferred currency.",
    watch: "Price Watch",
  },
  "zh-TW": {
    prompt: "想去哪裡？",
    explore: "探索航班",
    fares: "票價選項",
    showAll: (n: number) => `顯示全部 ${String(n)} 個航班`,
    nonstop: "直飛",
    results: "搜尋結果",
    advice: "票價短評",
    price: "NT$ 25,000",
    highlights: "今日值得買的航班",
    ideas: "接下來可以試試",
    top: "熱門",
    sticker: "強烈買",
    cheapest: "最低價",
    sort: "排序方式",
    footnote: "價格為來回總價・1 位成人，來自 Google 航班，訂票前請再確認。",
    title: "找到你的好航班",
    order: "價格由低到高",
    meta: "直飛・3 小時",
    oneStop: "轉機 1 次・3 小時 10 分",
    bell: "降價叫醒我",
    subtitle: "一位成人・來回經濟艙，票價以偏好幣別顯示。",
    watch: "降價叫醒我",
  },
} as const;

type Language = keyof typeof text;

function setup(
  language: Language,
  fares: (ReturnType<typeof fare> & { top?: boolean })[] = [fare("Example Air", 25000)],
) {
  const app = renderApp({ path: "/travel/flights", cookieUser: { ...makeUser("Rick"), language } });
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

const rows = (language: Language) =>
  within(screen.getByRole("list", { name: text[language].fares })).getAllByRole("listitem");

describe("Flight Radar compact price list", () => {
  it.each(["en", "zh-TW"] as const)(
    "lists fares cheapest first as cards of airline, price, time line, stops and duration in %s",
    async (language) => {
      const { api } = setup(language, threeFares);
      await explore(api, language);
      await screen.findByRole("list", { name: text[language].fares });
      expect(screen.queryByRole("group", { name: text[language].fares })).toBeNull();
      const list = rows(language);
      expect(list.map((row) => within(row).getByText(/Air$/).textContent)).toEqual([
        "Second Air",
        "Example Air",
        "Third Air",
      ]);
      const first = list[0] as HTMLElement;
      expect(within(first).getByText("08:00")).toBeVisible();
      expect(within(first).getByText("12:00")).toBeVisible();
      expect(within(first).getByText(text[language].meta)).toBeVisible();
      expect(within(first).getByText("NT$ 21,000").closest("[data-flap]")).toHaveClass(
        "tabular-nums",
      );
      // A time line with a plane between departure and arrival, never a flight number or baggage.
      expect(first.querySelector("svg path[d^='M21 16v-2']")).not.toBeNull();
      expect(first).toHaveClass("fr-fare");
      // The route line's airport code sits right before the departure time in the text, so it is dropped first.
      expect(first.textContent.replace(/[A-Z]{3}(?=\d{2}:)/g, "")).not.toMatch(
        /baggage|行李|[A-Z]{2}\d{2,4}/,
      );
    },
  );

  it.each(["en", "zh-TW"] as const)(
    "titles the list and writes the Google Flights footnote once after it in %s",
    async (language) => {
      const { api } = setup(language, threeFares);
      await explore(api, language);
      const list = await screen.findByRole("list", { name: text[language].fares });
      expect(screen.getByRole("heading", { name: text[language].title })).toBeVisible();
      expect(screen.getByText(text[language].order)).toBeVisible();
      const note = screen.getByText(text[language].footnote);
      expect(screen.getAllByText(text[language].footnote)).toHaveLength(1);
      expect(list.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      for (const row of rows(language))
        expect(within(row).queryByText(text[language].footnote)).toBeNull();
    },
  );

  it.each(["en", "zh-TW"] as const)(
    "shows stops and duration for a connection in %s",
    async (language) => {
      const { api } = setup(language, [
        { ...fare("Hop Air", 20000), stops: 1, durationMinutes: 190 },
      ]);
      await explore(api, language);
      await screen.findByRole("list", { name: text[language].fares });
      // The stop count sits on the visible route line, not only in screen-reader text.
      const stops = screen.getByTestId("fare-stops");
      expect(stops).toHaveTextContent(language === "en" ? "1 stop · 3h 10m" : "轉機 1 次 · 3h 10m");
      expect(stops.closest(".sr-only")).toBeNull();
    },
  );

  it("shows no stop text on a nonstop fare", async () => {
    const { api } = setup("en", [fare("Direct Air", 20000)]);
    await explore(api, "en");
    await screen.findByRole("list", { name: text.en.fares });
    expect(screen.queryByTestId("fare-stops")?.textContent ?? "").not.toMatch(/stop/i);
  });

  it.each(["en", "zh-TW"] as const)(
    "keeps a plain search's price note for screen readers only in %s",
    async (language) => {
      const { api } = setup(language, [fare("Plain Air", 20000)]);
      await explore(api, language);
      await screen.findByRole("list", { name: text[language].fares });
      expect(screen.getByTestId("fare-note")).toHaveClass("sr-only");
    },
  );

  it.each(["en", "zh-TW"] as const)(
    "gives only the Strong Buy card an amber edge, not Top or plain cards in %s",
    async (language) => {
      const { api } = setup(language, [
        { ...fare("Raised Air", 18000, "low"), top: true },
        { ...fare("Top Air", 30000, "typical"), top: true },
        fare("Plain Air", 31000, "typical"),
      ]);
      await explore(api, language);
      await screen.findByRole("list", { name: text[language].fares });
      expect(rows(language).map((row) => row.getAttribute("data-strong"))).toEqual([
        "true",
        null,
        null,
      ]);
      // The reference mock marks Strong Buy only by its sticker in the signal slot, not by an amber card edge.
      expect((rows(language)[0] as HTMLElement).className).not.toMatch(/amber|border-l/);
    },
  );

  it.each(["en", "zh-TW"] as const)(
    "shows ten rows, then every fare after the show-all button in %s",
    async (language) => {
      const many = Array.from({ length: 12 }, (_, i) => fare(`Air ${String(i)} Air`, 20000 + i));
      const { api } = setup(language, many);
      await explore(api, language);
      await screen.findByRole("list", { name: text[language].fares });
      expect(rows(language)).toHaveLength(10);
      fireEvent.click(screen.getByRole("button", { name: text[language].showAll(12) }));
      expect(rows(language)).toHaveLength(12);
      expect(screen.queryByRole("button", { name: text[language].showAll(12) })).toBeNull();
    },
  );

  it("offers no show-all button for ten fares or fewer", async () => {
    const { api } = setup("en", threeFares);
    await explore(api, "en");
    await screen.findByRole("list", { name: text.en.fares });
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
  });

  it.each(["en", "zh-TW"] as const)(
    "makes each card a link to Google Flights with a 44 px Price Watch bell in %s",
    async (language) => {
      const { api } = setup(language, threeFares);
      await explore(api, language);
      await screen.findByRole("list", { name: text[language].fares });
      const link = within(rows(language)[0] as HTMLElement).getByRole("link");
      expect(link).toHaveAttribute("href", expect.stringContaining("google.com/travel/flights"));
      expect(link.closest("li")).toHaveClass("fr-fare");
      const bell = within(rows(language)[0] as HTMLElement).getByRole("button", {
        name: text[language].bell,
      });
      // Mock-sized pill (about 38 px) with a 44 px hit area from the .fr-hit pseudo-element.
      expect(bell).toHaveClass("fr-hit");
      expect(link).not.toContainElement(bell);
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
      await screen.findByRole("list", { name: text[language].fares });
      const third = rows(language)[2] as HTMLElement;
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
        expect(screen.queryByRole("list", { name: text[language].fares })).toBeNull();
      });
      expect(
        await screen.findByRole("link", { name: language === "en" ? "View Flights" : "查看航班" }),
      ).toBeVisible();
    },
  );

  const mixed = [
    fare("Plain Air", 18000, "typical"),
    { ...fare("Top Dear Air", 30000, "typical"), top: true },
    { ...fare("Top Mid Air", 26000, "typical"), top: true },
    fare("Other Air", 22000, "typical"),
  ];
  const order = (language: Language) =>
    rows(language).map((row) => within(row).getByText(/Air$/).textContent);

  it.each(["en", "zh-TW"] as const)(
    "lists every fare in one list by price, tagging top fares without reordering in %s",
    async (language) => {
      const { api } = setup(language, mixed);
      await explore(api, language);
      await screen.findByRole("list", { name: text[language].fares });
      expect(screen.getByRole("group", { name: text[language].sort })).toBeVisible();
      expect(screen.queryByRole("button", { name: text[language].cheapest })).toBeNull();
      expect(order(language)).toEqual(["Plain Air", "Other Air", "Top Mid Air", "Top Dear Air"]);
      expect(
        rows(language).map((row) => within(row).queryByText(text[language].top) !== null),
      ).toEqual([false, false, true, true]);
    },
  );

  it.each(["en", "zh-TW"] as const)(
    "puts a Strong Buy sticker on raised fares, a Top tag on other top fares, nothing else in %s",
    async (language) => {
      const { api } = setup(language, [
        { ...fare("Raised Air", 18000, "low"), top: true },
        fare("History Air", 19000, "low"),
        { ...fare("Top Air", 30000, "typical"), top: true },
        fare("Plain Air", 31000, "typical"),
      ]);
      await explore(api, language);
      await screen.findByRole("list", { name: text[language].fares });
      const labels = rows(language).map((row) => ({
        sticker: within(row).queryByText(text[language].sticker),
        top: within(row).queryByText(text[language].top),
      }));
      expect(labels.map((l) => [l.sticker !== null, l.top !== null])).toEqual([
        [true, false],
        [true, false],
        [false, true],
        [false, false],
      ]);
      const sticker = labels[0]?.sticker as HTMLElement;
      // The reference mock's signal pill is text only (no lightning icon), and it is static.
      expect(sticker.querySelector("svg")).toBeNull();
      expect(sticker).toHaveClass("sticker");
      expect(sticker.textContent).toBe(text[language].sticker);
    },
  );

  it.each([
    ["en", "Buy", "Hold"],
    ["zh-TW", "可買", "觀望"],
  ] as const)(
    "shows the real Buy and Hold signal on every other fare, beside the Top tag, in %s",
    async (language, buy, hold) => {
      const { api } = setup(language, [
        { ...fare("Top Air", 30000, "typical"), top: true },
        fare("Plain Air", 31000, "typical"),
        fare("Dear Air", 40000, "high"),
      ]);
      await explore(api, language);
      await screen.findByRole("list", { name: text[language].fares });
      expect(
        rows(language).map((row) => [
          within(row).queryByText(text[language].top) !== null,
          within(row).queryByText(buy) !== null,
          within(row).queryByText(hold) !== null,
        ]),
      ).toEqual([
        [true, true, false],
        [false, true, false],
        [false, false, true],
      ]);
    },
  );

  it("keeps fares of equal price in the order the reply gave them", async () => {
    const { api } = setup("en", [fare("First Air", 20000), fare("Second Air", 20000)]);
    await explore(api, "en");
    await screen.findByRole("list", { name: text.en.fares });
    expect(order("en")).toEqual(["First Air", "Second Air"]);
  });

  it.each(["en", "zh-TW"] as const)("never shows ISO dates in the list in %s", async (language) => {
    const { api } = setup(language, threeFares);
    await explore(api, language);
    const list = await screen.findByRole("list", { name: text[language].fares });
    expect(within(list).queryByText(/2027-01/)).toBeNull();
  });
});

describe("Flight Radar results first", () => {
  const original = window.matchMedia.bind(window);
  afterEach(() => {
    window.matchMedia = original;
  });
  const follows = (a: Element, b: Element) =>
    Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  it.each(["en", "zh-TW"] as const)(
    "keeps the highlights in the passengers sheet and shows no results before a search in %s",
    async (language) => {
      setup(language, threeFares);
      expect(await screen.findByLabelText(text[language].prompt)).toBeVisible();
      await openFilters();
      expect(screen.getByRole("region", { name: text[language].highlights })).toBeVisible();
      expect(screen.queryByRole("region", { name: text[language].results })).toBeNull();
      expect(screen.queryByRole("region", { name: text[language].ideas })).toBeNull();
    },
  );

  it.each(["en", "zh-TW"] as const)(
    "puts the list first after a search, with the advice line, ideas and highlights below in %s",
    async (language) => {
      const { api } = setup(language, threeFares);
      await explore(api, language);
      const list = await screen.findByRole("list", { name: text[language].fares });
      const advice = await screen.findByRole("region", { name: text[language].advice });
      const ideas = await screen.findByRole("region", { name: text[language].ideas });
      const summary = screen.getByRole("region", { name: /^(Search summary|搜尋摘要)$/ });
      expect(follows(summary, advice)).toBe(true);
      expect(follows(advice, list)).toBe(true);
      expect(follows(list, ideas)).toBe(true);
      // The highlights moved into the passengers sheet, which the panel opens.
      await openFilters();
      expect(screen.getByRole("region", { name: text[language].highlights })).toBeVisible();
      expect(within(ideas).getAllByRole("button").length).toBeGreaterThan(0);
      expect(within(advice).queryByRole("button")).toBeNull();
    },
  );

  it("scrolls to the results when a search finishes, jumping under reduced motion", async () => {
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    scroll.mockClear();
    const { api } = setup("en", threeFares);
    await explore(api, "en");
    await screen.findByRole("list", { name: text.en.fares });
    await waitFor(() => {
      expect(scroll).toHaveBeenCalledTimes(1);
    });
    expect(scroll).toHaveBeenLastCalledWith({ behavior: "auto", block: "start" });
    const target = scroll.mock.contexts.at(-1) as Element;
    expect(target.contains(screen.getByRole("region", { name: text.en.results }))).toBe(true);
    expect(target.contains(screen.getByRole("list", { name: text.en.fares }))).toBe(true);
  });

  it("glides to the results when motion is allowed", async () => {
    window.matchMedia = (query) => ({ matches: false, media: query }) as MediaQueryList;
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    scroll.mockClear();
    const { api } = setup("en", threeFares);
    await explore(api, "en");
    await screen.findByRole("list", { name: text.en.fares });
    await waitFor(() => {
      expect(scroll).toHaveBeenLastCalledWith({ behavior: "smooth", block: "start" });
    });
  });
});
