import type { FlightCard, FlightSearchIntent } from "@split/shared";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import { openSearchPanel } from "../../test/flight-panel.js";
import { renderApp } from "../../test/render-app.js";

const languages = ["en", "zh-TW"] as const;
type Language = (typeof languages)[number];
const words = {
  en: {
    origin: "Origin airport",
    destination: "Destination airport",
    departure: "Departure date",
    ret: "Return date",
    search: "Search flights",
    swap: "Swap origin and destination",
    tokyo: "Tokyo",
    haneda: "Tokyo Haneda",
    okinawa: "Okinawa",
    explore: "Explore flights",
    prompt: "Where would you like to go?",
    advice: "Deal commentary",
    recent: "Recent",
    popular: "Popular",
  },
  "zh-TW": {
    origin: "出發機場",
    destination: "目的地機場",
    departure: "出發日期",
    ret: "回程日期",
    search: "搜尋航班",
    swap: "對調出發與目的地",
    tokyo: "東京",
    haneda: "東京羽田",
    okinawa: "沖繩",
    explore: "探索航班",
    prompt: "想去哪裡？",
    advice: "票價短評",
    recent: "最近搜尋",
    popular: "熱門",
  },
} as const;

const intent: FlightSearchIntent = {
  origin: "TPE",
  destination: "OKA",
  departureDate: "2027-01-08",
  returnDate: "2027-01-11",
  currency: "TWD",
  budget: 15000,
  excludeRedEye: false,
  directOnly: false,
};

function open(language: Language, path = "/travel") {
  const rendered = renderApp({ path, cookieUser: { ...makeUser("Rick"), language } });
  const w = words[language];
  const field = async (name: "origin" | "destination") => {
    await openSearchPanel();
    return screen.findByRole("combobox", { name: w[name] });
  };
  return { ...rendered, w, field };
}
const searches = (api: ReturnType<typeof open>["api"]) =>
  api.requests
    .filter((r) => r.route === "POST /api/v1/flights/search")
    .map((r) => JSON.parse(r.body ?? "{}") as Record<string, unknown>);

beforeEach(() => {
  localStorage.clear();
});

describe.each(languages)("Flight Radar airport picker in %s", (language) => {
  it("finds airports by Chinese name, English name and code", async () => {
    const { field, w } = open(language);
    const destination = await field("destination");
    for (const query of ["東京", "tokyo", "nrt"]) {
      fireEvent.focus(destination);
      fireEvent.change(destination, { target: { value: query } });
      const options = within(screen.getByRole("listbox")).getAllByRole("option");
      expect(options[0]).toHaveTextContent(/NRT/);
      expect(options[0]).toHaveTextContent(w.tokyo);
    }
    fireEvent.change(destination, { target: { value: "東京" } });
    expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(2);
  });

  it("picks a listed airport with the mouse and searches its code", async () => {
    const { api, field, w } = open(language);
    const destination = await field("destination");
    fireEvent.focus(destination);
    fireEvent.change(destination, { target: { value: w.okinawa.toLowerCase() } });
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: /OKA/ }));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(destination).toHaveValue(`${w.okinawa} (OKA)`);
    fireEvent.click(screen.getByRole("button", { name: w.search }));
    await screen.findByText("Example Air");
    expect(searches(api)[0]).toMatchObject({ origin: "TPE", destination: "OKA" });
  });

  it("works from the keyboard", async () => {
    const { api, field, w } = open(language);
    const destination = await field("destination");
    fireEvent.focus(destination);
    fireEvent.change(destination, { target: { value: "tokyo" } });
    expect(destination).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(destination, { key: "ArrowDown" });
    fireEvent.keyDown(destination, { key: "ArrowDown" });
    fireEvent.keyDown(destination, { key: "Enter" });
    expect(destination).toHaveValue(`${w.haneda} (HND)`);
    expect(api.requests.some((r) => r.route === "POST /api/v1/flights/search")).toBe(false);
    fireEvent.focus(destination);
    fireEvent.change(destination, { target: { value: "osak" } });
    fireEvent.keyDown(destination, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.blur(destination);
    expect(destination).toHaveValue(`${w.haneda} (HND)`);
    fireEvent.click(screen.getByRole("button", { name: w.search }));
    await screen.findByText("Example Air");
    expect(searches(api)[0]).toMatchObject({ destination: "HND" });
  });

  it("accepts a well-formed unlisted code and drops half-typed text on leaving", async () => {
    const { api, field, w } = open(language);
    const destination = await field("destination");
    fireEvent.focus(destination);
    fireEvent.change(destination, { target: { value: "lhr" } });
    expect(within(screen.getByRole("listbox")).queryByRole("option")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: w.search }));
    await screen.findByText("Example Air");
    expect(searches(api)[0]).toMatchObject({ destination: "LHR" });
    const reopened = await field("destination");
    fireEvent.focus(reopened);
    fireEvent.change(reopened, { target: { value: "zzzz" } });
    fireEvent.blur(reopened);
    expect(reopened).toHaveValue("LHR");
  });

  it("offers popular choices when empty, then recent searches", async () => {
    const { field, w } = open(language);
    const origin = await field("origin");
    fireEvent.focus(origin);
    let list = screen.getByRole("listbox");
    expect(within(list).getByText(w.popular)).toBeVisible();
    expect(
      within(list)
        .getAllByRole("option")
        .map((o) => o.textContent)
        .join(" "),
    ).toMatch(/TPE.*TSA.*RMQ.*KHH/);
    fireEvent.blur(origin);

    const destination = screen.getByRole("combobox", { name: w.destination });
    fireEvent.focus(destination);
    fireEvent.change(destination, { target: { value: "KIX" } });
    fireEvent.click(screen.getByRole("button", { name: w.search }));
    await screen.findByText("Example Air");

    const reopened = await field("destination");
    fireEvent.focus(reopened);
    fireEvent.change(reopened, { target: { value: "" } });
    list = screen.getByRole("listbox");
    expect(within(list).getByText(w.recent)).toBeVisible();
    expect(within(list).getAllByRole("option")[0]).toHaveTextContent("KIX");
  });

  it("swaps origin and destination in one tap", async () => {
    const { api, field, w } = open(language);
    const origin = await field("origin");
    const destination = await field("destination");
    fireEvent.change(destination, { target: { value: "NRT" } });
    fireEvent.click(screen.getByRole("button", { name: w.swap }));
    expect(origin).toHaveValue(`${w.tokyo} (NRT)`);
    expect(destination).toHaveDisplayValue(/TPE/);
    fireEvent.click(screen.getByRole("button", { name: w.search }));
    await screen.findByText("Example Air");
    expect(searches(api)[0]).toMatchObject({ origin: "NRT", destination: "TPE" });
  });

  describe("shows what was searched", () => {
    it("after a prompt, a next-move chip and a panel search", async () => {
      const { api, field, w } = open(language);
      api.flightPromptIntent = intent;
      fireEvent.change(await screen.findByLabelText(w.prompt), { target: { value: "okinawa" } });
      fireEvent.click(screen.getByRole("button", { name: w.explore }));
      await screen.findByText("Example Air");
      expect(await field("origin")).toHaveDisplayValue(/TPE/);
      expect(screen.getByRole("combobox", { name: w.destination })).toHaveValue(
        `${w.okinawa} (OKA)`,
      );
      expect(screen.getByLabelText(w.departure)).toHaveValue("2027-01-08");
      expect(screen.getByLabelText(w.ret)).toHaveValue("2027-01-11");

      const advice = await screen.findByRole("region", { name: w.advice });
      fireEvent.click(within(advice).getAllByRole("button")[0] as HTMLElement);
      await waitFor(() => {
        expect(searches(api)).toHaveLength(2);
      });
      await field("origin");
      await waitFor(() => {
        expect(screen.getByLabelText(w.departure)).toHaveValue("2027-01-07");
      });
      expect(screen.getByLabelText(w.ret)).toHaveValue("2027-01-10");

      fireEvent.change(screen.getByRole("combobox", { name: w.origin }), {
        target: { value: "KHH" },
      });
      fireEvent.click(screen.getByRole("button", { name: w.search }));
      await waitFor(() => {
        expect(searches(api)).toHaveLength(3);
      });
      expect(await field("origin")).toHaveDisplayValue(/KHH/);
    });

    it("after a verified highlight tap", async () => {
      const { api, field, w } = open(language);
      api.flightHighlights.push({
        price: 25000,
        airline: "Example Air",
        outboundDeparture: "08:00",
        outboundArrival: "12:00",
        inboundDeparture: null,
        inboundArrival: null,
        stops: 0,
        durationMinutes: 180,
        priceLevel: "low",
        intent: { ...intent, origin: "KHH", destination: "KIX" },
        signal: "strong_buy",
        overBudget: 0,
        url: "https://example.test/f",
      } satisfies FlightCard);
      fireEvent.click(await screen.findByRole("button", { name: /KHH → KIX/ }));
      await screen.findByText("Example Air");
      expect(await field("origin")).toHaveDisplayValue(/KHH/);
      expect(screen.getByRole("combobox", { name: w.destination })).toHaveDisplayValue(/KIX/);
    });

    it("on arrival from a LINE portal link", async () => {
      const query = new URLSearchParams({
        origin: "KHH",
        destination: "NRT",
        departureDate: "2027-02-05",
        returnDate: "2027-02-09",
        currency: "TWD",
        excludeRedEye: "0",
        directOnly: "0",
      });
      const { field, w } = open(language, `/travel?${query.toString()}`);
      await screen.findByText("Example Air");
      expect(await field("origin")).toHaveDisplayValue(/KHH/);
      expect(screen.getByRole("combobox", { name: w.destination })).toHaveValue(`${w.tokyo} (NRT)`);
      expect(screen.getByLabelText(w.departure)).toHaveValue("2027-02-05");
    });
  });
});
