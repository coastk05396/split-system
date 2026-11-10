import type { FlightSearchIntent } from "@split/shared";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { askPrompt } from "../../test/flight-panel.js";
import { renderApp } from "../../test/render-app.js";
import { makeUser } from "../../test/fake-api.js";

const intent: FlightSearchIntent = {
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
  outboundDeparture: string,
  durationMinutes: number,
  top = false,
) => ({
  price,
  airline,
  outboundDeparture,
  outboundArrival: "12:00",
  inboundDeparture: "18:00",
  inboundArrival: "20:00",
  stops: 0,
  durationMinutes,
  priceLevel: "typical" as const,
  top,
});

// Departures use the container's real "YYYY-MM-DDTHH:MM" format. Cheapest: Noon. Fastest: Dawn. Red-eye: Dawn (02:30), Late (22:00), Edge (04:59); not Five (05:00) or Early (21:59).
const fares = [
  fare("Noon Air", 20000, "2026-12-01T12:00", 200),
  fare("Dawn Air", 25000, "2026-12-01T02:30", 150),
  fare("Late Air", 30000, "2026-12-01T22:00", 180, true),
  fare("Edge Air", 31000, "2026-12-01T04:59", 190),
  fare("Five Air", 32000, "2026-12-01T05:00", 210),
  fare("Early Air", 33000, "2026-12-01T21:59", 220),
];

const text = {
  en: {
    fares: "Fares",
    group: "Sort fares",
    price: "Price",
    time: "Time",
    priceUp: "Sort by price, low to high",
    priceDown: "Sort by price, high to low",
    timeUp: "Sort by time, earliest first",
    timeDown: "Sort by time, latest first",
    cheapest: "Cheapest",
    fastest: "Fastest",
    redEye: "Red-eye",
    top: "Top",
    prompt: "Where would you like to go?",
    explore: "Explore flights",
  },
  "zh-TW": {
    fares: "票價選項",
    group: "排序方式",
    price: "價格",
    time: "時間",
    priceUp: "依價格排序，低到高",
    priceDown: "依價格排序，高到低",
    timeUp: "依時間排序，早到晚",
    timeDown: "依時間排序，晚到早",
    cheapest: "最便宜",
    fastest: "最快",
    redEye: "紅眼",
    top: "熱門",
    prompt: "想去哪裡？",
    explore: "探索航班",
  },
} as const;

type Language = keyof typeof text;

async function open(language: Language) {
  const app = renderApp({ path: "/travel", cookieUser: { ...makeUser("Rick"), language } });
  app.api.flightFares = fares;
  app.api.flightPromptIntent = intent;
  await askPrompt("warm island");
  await screen.findByRole("list", { name: text[language].fares });
}

const rows = (language: Language) =>
  within(screen.getByRole("list", { name: text[language].fares })).getAllByRole("listitem");
const airline = (row: HTMLElement) => within(row).getByText(/Air$/).textContent.replace(" Air", "");
const names = (language: Language) => rows(language).map(airline);

const tap = (name: string) => {
  fireEvent.click(screen.getByRole("button", { name }));
};
const pressed = (name: string) => screen.getByRole("button", { name }).getAttribute("aria-pressed");

describe.each(["en", "zh-TW"] as const)("Flight Radar sort buttons and tags in %s", (language) => {
  const l = text[language];

  it("starts cheapest first with price pressed and time not", async () => {
    await open(language);
    expect(
      within(screen.getByRole("group", { name: l.group })).getAllByRole("button"),
    ).toHaveLength(2);
    expect(names(language)).toEqual(["Noon", "Dawn", "Late", "Edge", "Five", "Early"]);
    expect(pressed(l.priceUp)).toBe("true");
    expect(screen.getByRole("button", { name: l.priceUp })).toHaveTextContent(`${l.price}↑`);
    expect(pressed(l.timeUp)).toBe("false");
  });

  it("reverses price on a second tap and back on a third", async () => {
    await open(language);
    tap(l.priceUp);
    expect(names(language)).toEqual(["Early", "Five", "Edge", "Late", "Dawn", "Noon"]);
    expect(pressed(l.priceDown)).toBe("true");
    expect(screen.getByRole("button", { name: l.priceDown })).toHaveTextContent(`${l.price}↓`);
    tap(l.priceDown);
    expect(names(language)[0]).toBe("Noon");
    expect(pressed(l.priceUp)).toBe("true");
  });

  it("sorts by departure time, reverses on repeat, and price returns to cheapest first", async () => {
    await open(language);
    tap(l.timeUp);
    expect(names(language)).toEqual(["Dawn", "Edge", "Five", "Noon", "Early", "Late"]);
    expect(pressed(l.timeUp)).toBe("true");
    expect(pressed(l.priceUp)).toBe("false");
    tap(l.timeUp);
    expect(names(language)).toEqual(["Late", "Early", "Noon", "Five", "Edge", "Dawn"]);
    expect(screen.getByRole("button", { name: l.timeDown })).toHaveTextContent(`${l.time}↓`);
    tap(l.priceUp);
    expect(names(language)).toEqual(["Noon", "Dawn", "Late", "Edge", "Five", "Early"]);
  });

  it("tags the lowest price, the shortest trip and red-eyes on matching fares only", async () => {
    await open(language);
    const tagged = (tag: string) =>
      rows(language)
        .filter((row) => within(row).queryByText(tag) !== null)
        .map(airline);
    expect(tagged(l.cheapest)).toEqual(["Noon"]);
    expect(tagged(l.fastest)).toEqual(["Dawn"]);
    expect(tagged(l.redEye)).toEqual(["Dawn", "Late", "Edge"]);
  });

  it("keeps the top tag as a mark that never reorders", async () => {
    await open(language);
    expect(screen.getAllByText(l.top)).toHaveLength(1);
    expect(names(language)).toEqual(["Noon", "Dawn", "Late", "Edge", "Five", "Early"]);
  });
});
