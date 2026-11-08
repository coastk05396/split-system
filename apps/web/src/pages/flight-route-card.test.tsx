import type { FlightSearchIntent } from "@split/shared";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { flightSearchRequestSchema } from "@split/shared";
import { makeUser } from "../../test/fake-api.js";
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
    dates: "Jan 8 – Jan 11 · 1 adult",
    edit: "Edit",
    search: "Explore flights again",
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
    dates: "1/8（五）– 1/11（一）・1 位成人",
    edit: "修改",
    search: "重新探索航班",
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
  const app = renderApp({ path: "/travel", cookieUser: { ...makeUser("Rick"), language } });
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
      expect(within(card).getByText(text[language].origin)).toBeVisible();
      expect(within(card).getByText(text[language].destination)).toBeVisible();
      expect(within(card).getByText("TPE")).toBeVisible();
      expect(within(card).getByText("OKA")).toBeVisible();
      expect(within(card).getByText("TPE")).toHaveClass("text-[40px]");
      expect(within(card).getByText(text[language].leg)).toBeVisible();
      expect(within(card).getByText(text[language].dates)).toBeVisible();
      // The route-and-dates pill is gone; the other pills stay below the card.
      expect(screen.queryByRole("button", { name: /^TPE → OKA ・/ })).toBeNull();
      const pills = screen.getByRole("region", { name: text[language].pills });
      expect(within(pills).getByRole("button", { name: text[language].budget })).toBeVisible();
      expect(card.compareDocumentPosition(pills) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    },
  );

  it.each(["en", "zh-TW"] as const)(
    "names the destination in the headline and drops the globe in %s",
    async (language) => {
      setup(language);
      expect(
        await screen.findByRole("heading", { level: 1, name: text[language].headline }),
      ).toBeVisible();
      expect(screen.queryByRole("img")).toBeNull();
      expect(document.querySelector("canvas")).toBeNull();
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
    "opens the Price Watch radar from a 44 px bell in %s",
    async (language) => {
      setup(language);
      const bell = await screen.findByRole("button", { name: text[language].bell });
      expect(bell).toHaveClass("min-h-11", "min-w-11");
      expect(bell.querySelector("svg")).not.toBeNull();
      const radar = screen.getByText(text[language].watches).closest("details");
      expect(radar).not.toHaveAttribute("open");
      fireEvent.click(bell);
      expect(radar).toHaveAttribute("open");
      expect(screen.getByRole("region", { name: text[language].watches })).toBeVisible();
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
    expect(within(card).getAllByText("ZZZ")).toHaveLength(1);
    expect(card).not.toHaveTextContent(/km/);
    expect(card).not.toHaveTextContent(/NaN|undefined/);
  });

  it.each(["en", "zh-TW"] as const)(
    "opens and closes the editing panel with the edit button in %s",
    async (language) => {
      setup(language);
      const card = await screen.findByRole("region", { name: text[language].card });
      const edit = within(card).getByRole("button", { name: text[language].edit });
      expect(edit).toHaveAttribute("aria-expanded", "false");
      expect(edit.querySelector("svg")).not.toBeNull();
      fireEvent.click(edit);
      expect(edit).toHaveAttribute("aria-expanded", "true");
      expect(
        screen.getByRole("form", { name: /^(Edit search condition|修改搜尋條件)$/ }),
      ).toBeVisible();
      fireEvent.click(edit);
      expect(
        screen.queryByRole("form", { name: /^(Edit search condition|修改搜尋條件)$/ }),
      ).toBeNull();
    },
  );

  it.each(["en", "zh-TW"] as const)(
    "searches the shown search in one tap, without a prompt parse, in %s",
    async (language) => {
      const { api } = setup(language);
      await explore(language);
      const card = screen.getByRole("region", { name: text[language].card });
      fireEvent.click(within(card).getByRole("button", { name: text[language].search }));
      await waitFor(() => {
        expect(searches(api)).toHaveLength(2);
      });
      const request = flightSearchRequestSchema.parse(JSON.parse(searches(api)[1]?.body ?? "{}"));
      expect(request).not.toHaveProperty("prompt");
      expect(request).toMatchObject({ origin: "TPE", destination: "OKA", budget: 15000 });
    },
  );

  it.each(["en", "zh-TW"] as const)(
    "gives both buttons 44 px targets and wraps long names in %s",
    async (language) => {
      setup(language);
      const card = await screen.findByRole("region", { name: text[language].card });
      expect(within(card).getByRole("button", { name: text[language].edit })).toHaveClass(
        "min-h-11",
      );
      expect(within(card).getByRole("button", { name: text[language].search })).toHaveClass(
        "min-h-12",
      );
      expect(
        within(card).getByRole("button", { name: text[language].search }).querySelector("svg"),
      ).not.toBeNull();
    },
  );
});
