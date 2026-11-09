import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FlightSearchIntent } from "@split/shared";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderApp } from "../../test/render-app.js";
import { makeUser } from "../../test/fake-api.js";
import { contrast } from "../../test/contrast.js";

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

const fare = (airline: string, price: number) => ({
  price,
  airline,
  outboundDeparture: "2026-12-01T09:00",
  outboundArrival: "12:00",
  inboundDeparture: "18:00",
  inboundArrival: "20:00",
  stops: 0,
  durationMinutes: 180,
  priceLevel: "typical" as const,
});
const fares = [fare("Noon Air", 20000), fare("Dawn Air", 25000), fare("Late Air", 30000)];

const text = {
  en: {
    prompt: "Where would you like to go?",
    explore: "Explore flights",
    fares: "Fares",
    results: "Search results",
    list: "List view",
    swipe: "Swipe view",
    watch: "Price Watch",
    added: "Price Watch added",
    enable: "Enable browser alert",
  },
  "zh-TW": {
    prompt: "想去哪裡？",
    explore: "探索航班",
    fares: "票價選項",
    results: "搜尋結果",
    list: "清單檢視",
    swipe: "滑動檢視",
    watch: "降價叫醒我",
    added: "已加入降價雷達",
    enable: "開啟瀏覽器通知",
  },
} as const;
type Language = keyof typeof text;

const reduced = window.matchMedia.bind(window);
afterEach(() => {
  window.matchMedia = reduced;
});
const allowMotion = () => {
  window.matchMedia = (query) => ({ matches: false, media: query }) as MediaQueryList;
};

async function open(language: Language, hold = false) {
  const app = renderApp({
    path: "/travel/flights",
    cookieUser: { ...makeUser("Rick"), language },
    webPush: {
      subscribe: () =>
        Promise.resolve({
          endpoint: "https://fcm.googleapis.com/t",
          keys: { p256dh: "t", auth: "t" },
        }),
    },
  });
  app.api.flightFares = fares;
  // Saved prices for the Price Strip window (30 days from 2026-12-29), so its dock appears.
  app.api.flightPriceStrip = Array.from({ length: 30 }, (_, n) => ({
    date: new Date(Date.UTC(2026, 11, 29 + n)).toISOString().slice(0, 10),
    price: 6000 + n * 50,
    fetchedAt: 1,
  }));
  app.api.flightPromptIntent = intent;
  const release = hold ? app.api.holdResponses("POST /api/v1/flights/search") : () => undefined;
  fireEvent.change(await screen.findByLabelText(text[language].prompt), {
    target: { value: "warm island" },
  });
  fireEvent.click(screen.getByRole("button", { name: text[language].explore }));
  if (!hold) await screen.findByRole("list", { name: text[language].fares });
  return release;
}
const list = (l: Language) => screen.getByRole("list", { name: text[l].fares });
const rows = (l: Language) => within(list(l)).getAllByRole("listitem");
const dots = () => [...document.querySelectorAll("[data-dot]")];
const activeDot = () => dots().findIndex((d) => d.getAttribute("data-dot") === "on");

/** jsdom has no layout: give the list a card width and scroll it to the n-th card. */
function scrollTo(l: Language, n: number) {
  const car = list(l);
  Object.defineProperty(rows(l)[0] as HTMLElement, "offsetWidth", {
    value: 250,
    configurable: true,
  });
  car.scrollLeft = n * 262;
  fireEvent.scroll(car);
}

describe.each(["en", "zh-TW"] as const)("Flight Radar fare carousel in %s", (language) => {
  const l = text[language];

  it("is one list of cards with a dot per fare that follows the swipe", async () => {
    await open(language);
    expect(screen.getAllByRole("list", { name: l.fares })).toHaveLength(1);
    expect(list(language)).toHaveAttribute("data-view", "carousel");
    expect(rows(language)).toHaveLength(3);
    expect(dots()).toHaveLength(3);
    expect(activeDot()).toBe(0);
    scrollTo(language, 2);
    expect(activeDot()).toBe(2);
    expect(rows(language).map((r) => r.dataset.active)).toEqual([undefined, undefined, "true"]);
  });

  it("keeps every fare reachable by Tab as a link with its bell, with no decorative copies", async () => {
    await open(language);
    for (const row of rows(language)) {
      expect(within(row).getByRole("link")).toHaveAttribute("href");
      expect(within(row).getByRole("button", { name: l.watch })).toBeVisible();
    }
    expect(screen.getAllByText("Noon Air")).toHaveLength(1);
    // Each price is read once, as a whole.
    expect(within(rows(language)[0] as HTMLElement).getAllByText(/20,000/)).toHaveLength(1);
    expect(dots().every((d) => d.closest("[aria-hidden=true]") !== null)).toBe(true);
  });

  it("switches to a plain list and back", async () => {
    await open(language);
    fireEvent.click(screen.getByRole("button", { name: l.list }));
    expect(list(language)).toHaveAttribute("data-view", "list");
    expect(dots()).toHaveLength(0);
    expect(rows(language)).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: l.swipe }));
    expect(list(language)).toHaveAttribute("data-view", "carousel");
  });

  it("rolls price and times like a split-flap board only when motion is allowed", async () => {
    allowMotion();
    await open(language);
    const price = within(rows(language)[0] as HTMLElement).getByText(/20,000/);
    expect(price.closest("[data-rolling]")).toHaveAttribute("data-rolling", "true");
    await waitFor(() => {
      expect(document.querySelector("[data-rolling]")).toBeNull();
    });
    expect(within(rows(language)[0] as HTMLElement).getByText(/20,000/)).toBeVisible();
  });

  it("does not roll under reduced motion", async () => {
    await open(language);
    expect(document.querySelector("[data-rolling]")).toBeNull();
    expect(list(language)).toHaveAttribute("data-motion", "reduced");
  });

  it("stamps and rings the bell when a fare is watched, with motion", async () => {
    allowMotion();
    await open(language);
    const row = rows(language)[1] as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: l.watch }));
    const drawer = await screen.findByRole("dialog", { name: l.watch });
    fireEvent.click(within(drawer).getByRole("button", { name: l.enable }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    const after = rows(language)[1] as HTMLElement;
    expect(within(after).getByRole("status")).toHaveTextContent(l.added);
    expect(after.querySelector(".stamp")).not.toBeNull();
    expect(within(after).getByRole("button", { name: l.watch })).toHaveClass("bell-ring");
    expect(rows(language)[0]?.querySelector(".stamp")).toBeNull();
  });

  it("only announces the watch under reduced motion", async () => {
    await open(language);
    const row = rows(language)[1] as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: l.watch }));
    const drawer = await screen.findByRole("dialog", { name: l.watch });
    fireEvent.click(within(drawer).getByRole("button", { name: l.enable }));
    await waitFor(() => {
      expect(within(rows(language)[1] as HTMLElement).getByRole("status")).toHaveTextContent(
        l.added,
      );
    });
    const after = rows(language)[1] as HTMLElement;
    expect(after.querySelector(".stamp")).toBeNull();
    expect(within(after).getByRole("button", { name: l.watch })).not.toHaveClass("bell-ring");
  });

  it("draws the loading skeleton with a scan line only when motion is allowed", async () => {
    allowMotion();
    const release = await open(language, true);
    const results = await screen.findByRole("region", { name: l.results });
    expect(results.querySelector(".scan")).not.toBeNull();
    release();
    await screen.findByRole("list", { name: l.fares });
    expect(results.querySelector(".scan")).toBeNull();
  });

  it("settles every rolling digit at once when reduced motion turns on mid-roll", async () => {
    allowMotion();
    await open(language);
    expect(document.querySelector("[data-rolling]")).not.toBeNull();
    window.matchMedia = reduced;
    // A full roll takes 600 ms or more; the switch must not wait for it.
    await waitFor(
      () => {
        expect(document.querySelector("[data-rolling]")).toBeNull();
      },
      { timeout: 250 },
    );
    for (const flap of document.querySelectorAll("[data-flap]")) {
      expect(flap.querySelector("[aria-hidden]")?.textContent).toBe(
        flap.querySelector(".sr-only")?.textContent,
      );
    }
  });

  it("rings the bell again when the same fare is saved a second time", async () => {
    allowMotion();
    await open(language);
    const save = async () => {
      const row = rows(language)[1] as HTMLElement;
      fireEvent.click(within(row).getByRole("button", { name: l.watch }));
      const drawer = await screen.findByRole("dialog", { name: l.watch });
      fireEvent.click(within(drawer).getByRole("button", { name: l.enable }));
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
      });
      return within(rows(language)[1] as HTMLElement)
        .getByRole("button", { name: l.watch })
        .querySelector("svg");
    };
    const first = await save();
    const second = await save();
    expect(first).not.toBeNull();
    // A new bell icon element restarts the CSS animation; the button keeps focus.
    expect(second).not.toBe(first);
  });
});

describe("Flight Radar sticky dock", () => {
  it("keeps the dock's spacer at the very end of the page, after the carousel", async () => {
    await open("en");
    await screen.findByRole("region", { name: "Cheapest fare by day" });
    const slot = document.getElementById("sticky-bar-slot");
    expect(slot?.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(slot?.nextElementSibling).toBeNull();
    expect(list("en").compareDocumentPosition(slot as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});

describe("Flight Radar fare carousel depth", () => {
  /** The stylesheet's own words: the fade a depth keyframe applies, 1 when it applies none. */
  const css = readFileSync(resolve(__dirname, "../styles.css"), "utf8");
  const depth = /@keyframes fare-depth \{([\s\S]*?)\n\}\n/.exec(css)?.[1] ?? "";
  const lowestOpacity = Math.min(
    1,
    ...[...depth.matchAll(/opacity:\s*([\d.]+)/g)].map((m) => Number(m[1])),
  );
  const page = "#e9f3ec";
  const mix = (fg: string, bg: string, alpha: number) =>
    "#" +
    [1, 3, 5]
      .map((i) =>
        Math.round(
          parseInt(fg.slice(i, i + 2), 16) * alpha + parseInt(bg.slice(i, i + 2), 16) * (1 - alpha),
        )
          .toString(16)
          .padStart(2, "0"),
      )
      .join("");

  it.each([
    ["muted metadata", "#4a6f5c", "#ffffff"],
    ["Cheapest tag", "#ffffff", "#26684b"],
    ["Fastest tag", "#245b41", "#e4f9e9"],
    ["price", "#143f2a", "#ffffff"],
  ])("keeps %s at 4.5:1 or more in the most receded state", (_name, fg, bg) => {
    // Composite both colours over the page at the receded card's opacity.
    expect(contrast(mix(fg, page, lowestOpacity), mix(bg, page, lowestOpacity))).toBeGreaterThan(
      4.5,
    );
  });
});
