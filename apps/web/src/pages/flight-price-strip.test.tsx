import { readFileSync } from "node:fs";
import { defaultFlightIntent } from "@split/shared";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { contrast } from "../../test/contrast.js";
import { makeUser } from "../../test/fake-api.js";
import { renderApp } from "../../test/render-app.js";

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const plus = (date: string, n: number) => iso(Date.parse(`${date}T00:00:00Z`) + n * DAY);

const intent = defaultFlightIntent(Date.now(), "TWD");
const searched = intent.departureDate;
const stay = Math.round((Date.parse(intent.returnDate ?? "") - Date.parse(searched)) / DAY);
/** The first of the 30 bars: ten days before the searched day, but never in the past. */
const first = iso(Math.max(Date.parse(iso(Date.now())), Date.parse(searched) - 10 * DAY));
const at = (n: number) => plus(first, n);
const indexOfSearched = Math.round((Date.parse(searched) - Date.parse(first)) / DAY);
const HOUR = 3_600_000;

const text = {
  en: {
    title: "Cheapest fare by day",
    slider: "Departure day",
    unavailable: "Prices are unavailable right now",
    loading: "Loading prices",
    note: "Saved prices: round trip with a 3-day stay, 1 adult, economy, the day's lowest. They can differ from the trip you chose.",
    age: "Updated 40 h ago",
    jump: "Jump to lowest",
    legend: ["Cheap", "Normal", "Pricey", "Your day"],
  },
  "zh-TW": {
    title: "每日最低價",
    slider: "出發日期",
    unavailable: "目前無法取得價格",
    loading: "價格載入中",
    note: "已儲存的價格：停留 3 天的來回票，1 位成人、經濟艙，取當日最低。可能與你選的行程不同。",
    age: "40 小時前更新",
    jump: "跳到最低",
    legend: ["便宜", "普通", "偏貴", "你選的日子"],
  },
} as const;
type Language = keyof typeof text;

function setup(language: Language) {
  return renderApp({ path: "/travel/flights", cookieUser: { ...makeUser("Rick"), language } });
}
const dock = (language: Language) => screen.findByRole("region", { name: text[language].title });
const slider = (language: Language) => screen.findByRole("slider", { name: text[language].slider });
const bars = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>("[data-kind]")];
const tip = (el: HTMLElement) => el.querySelector<HTMLElement>("[data-part='tip']");
/** One snapshot per day: prices[n] is the fare n days after the first bar; null leaves it unsaved. */
function save(app: ReturnType<typeof setup>, prices: (number | null)[], fetchedAt = Date.now()) {
  app.api.flightPriceStrip = prices.flatMap((price, n) =>
    price === null ? [] : [{ date: at(n), price, fetchedAt }],
  );
}
const original = window.matchMedia.bind(window);
afterEach(() => {
  window.matchMedia = original;
  vi.useRealTimers();
});
const searchedDays = (app: ReturnType<typeof setup>) =>
  app.api.flightSearchRequests.map((r) => ("prompt" in r ? "prompt" : r.departureDate));

describe("Flight Radar Price Strip dock", () => {
  it.each(["en", "zh-TW"] as const)(
    "draws 30 bars from saved prices, never searching, and marks the day searched in %s",
    async (language) => {
      const app = setup(language);
      // Day 0 and 1 are the dearest, the searched day the cheapest.
      const prices = Array.from(
        { length: 30 },
        (_, n) => 5000 + Math.abs(n - indexOfSearched) * 100,
      );
      save(app, prices);
      const strip = await slider(language);
      await waitFor(() => {
        expect(bars(strip).some((bar) => bar.dataset.kind !== "none")).toBe(true);
      });
      expect(bars(strip)).toHaveLength(30);
      expect(bars(strip)[indexOfSearched]).toHaveAttribute("data-selected", "true");
      expect(bars(strip).filter((bar) => bar.dataset.selected === "true")).toHaveLength(1);
      // Cheapest third is cheap, dearest fifth pricey, the rest normal.
      expect(bars(strip)[indexOfSearched]?.dataset.kind).toBe("cheap");
      expect(bars(strip).some((bar) => bar.dataset.kind === "pricey")).toBe(true);
      expect(bars(strip).some((bar) => bar.dataset.kind === "normal")).toBe(true);
      expect(within(await dock(language)).getByText(text[language].note)).toBeVisible();
      expect(app.api.calls).not.toContain("POST /api/v1/flights/search");
      // The window can span two months; each month is one stored-prices read.
      const months = new Set([first.slice(0, 7), at(29).slice(0, 7)]);
      expect(app.api.flightPriceStripQueries.sort()).toEqual(
        [...months].sort().map((m) => `?origin=TPE&destination=OKA&currency=TWD&month=${m}`),
      );
    },
  );

  it.each(["en", "zh-TW"] as const)(
    "is a slider named for the departure day with the day and fare as its value in %s",
    async (language) => {
      const app = setup(language);
      save(
        app,
        Array.from({ length: 30 }, (_, n) => (n === indexOfSearched ? 5000 : 7000)),
      );
      const strip = await slider(language);
      expect(strip).toHaveAttribute("aria-valuemin", "0");
      expect(strip).toHaveAttribute("aria-valuemax", "29");
      expect(strip).toHaveAttribute("aria-valuenow", String(indexOfSearched));
      await waitFor(() => {
        expect(strip.getAttribute("aria-valuetext")).toContain("NT$ 5,000");
      });
      expect(strip.tabIndex).toBe(0);
    },
  );

  it("shows a dashed empty bar for a day with no saved price, and says so", async () => {
    const app = setup("en");
    save(
      app,
      Array.from({ length: 30 }, (_, n) => (n === indexOfSearched ? null : 6000 + n * 10)),
    );
    const strip = await slider("en");
    await waitFor(() => {
      expect(bars(strip).some((bar) => bar.dataset.kind !== "none")).toBe(true);
    });
    expect(bars(strip)[indexOfSearched]).toHaveAttribute("data-kind", "none");
    expect(strip.getAttribute("aria-valuetext")).toContain("No price");
  });

  it("moves the chosen day with the arrow keys and searches once, live, after they settle", async () => {
    const app = setup("en");
    save(
      app,
      Array.from({ length: 30 }, (_, n) => 6000 + n * 100),
    );
    const strip = await slider("en");
    await waitFor(() => {
      expect(bars(strip).some((bar) => bar.dataset.kind !== "none")).toBe(true);
    });
    const start = indexOfSearched;
    fireEvent.keyDown(strip, { key: "ArrowRight" });
    fireEvent.keyDown(strip, { key: "ArrowRight" });
    fireEvent.keyDown(strip, { key: "ArrowLeft" });
    expect(strip).toHaveAttribute("aria-valuenow", String(start + 1));
    expect(bars(strip)[start + 1]).toHaveAttribute("data-selected", "true");
    // The tooltip names the day, its fare and how far it is from the searched day.
    const tooltip = tip(strip);
    expect(tooltip?.textContent).toContain(
      `NT$ ${(6000 + (start + 1) * 100).toLocaleString("en-US")}`,
    );
    const delta = tooltip?.querySelector("[data-direction]");
    expect(delta).toHaveAttribute("data-direction", "up");
    expect(delta?.textContent).toBe("100");
    expect(searchedDays(app)).toEqual([]);
    await waitFor(() => {
      expect(searchedDays(app)).toEqual([plus(searched, 1)]);
    });
    // The return keeps its stay.
    expect(app.api.flightSearchRequests[0]).toMatchObject({
      returnDate: plus(searched, 1 + stay),
    });
  });

  it("does not leave the first bar with the arrow keys", async () => {
    const app = setup("en");
    save(
      app,
      Array.from({ length: 30 }, () => 6000),
    );
    const strip = await slider("en");
    for (let i = 0; i < 40; i++) fireEvent.keyDown(strip, { key: "ArrowLeft" });
    expect(strip).toHaveAttribute("aria-valuenow", "0");
    for (let i = 0; i < 40; i++) fireEvent.keyDown(strip, { key: "ArrowRight" });
    expect(strip).toHaveAttribute("aria-valuenow", "29");
  });

  it("jumps to the ends with Home and End and by a week with Page Up and Page Down", async () => {
    const app = setup("en");
    save(
      app,
      Array.from({ length: 30 }, () => 6000),
    );
    const strip = await slider("en");
    fireEvent.keyDown(strip, { key: "Home" });
    expect(strip).toHaveAttribute("aria-valuenow", "0");
    fireEvent.keyDown(strip, { key: "PageUp" });
    expect(strip).toHaveAttribute("aria-valuenow", "7");
    fireEvent.keyDown(strip, { key: "PageDown" });
    fireEvent.keyDown(strip, { key: "PageDown" });
    expect(strip).toHaveAttribute("aria-valuenow", "0");
    fireEvent.keyDown(strip, { key: "End" });
    expect(strip).toHaveAttribute("aria-valuenow", "29");
    await waitFor(() => {
      expect(searchedDays(app)).toEqual([at(29)]);
    });
  });

  it("follows a drag across the bars and searches the day it was released on", async () => {
    const app = setup("en");
    save(
      app,
      Array.from({ length: 30 }, (_, n) => 9000 - n * 100),
    );
    const strip = await slider("en");
    await waitFor(() => {
      expect(bars(strip).some((bar) => bar.dataset.kind !== "none")).toBe(true);
    });
    // 30 columns of 10 px.
    strip.getBoundingClientRect = () => ({
      left: 0,
      width: 300,
      right: 300,
      top: 0,
      bottom: 96,
      height: 96,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(strip, { clientX: 5, pointerId: 1 });
    expect(strip).toHaveAttribute("aria-valuenow", "0");
    fireEvent.pointerMove(strip, { clientX: 125, pointerId: 1 });
    expect(strip).toHaveAttribute("aria-valuenow", "12");
    expect(tip(strip)?.textContent).toContain("NT$ 7,800");
    fireEvent.pointerMove(strip, { clientX: 1000, pointerId: 1 });
    expect(strip).toHaveAttribute("aria-valuenow", "29");
    fireEvent.pointerMove(strip, { clientX: 215, pointerId: 1 });
    // Nothing is searched while the finger moves.
    expect(searchedDays(app)).toEqual([]);
    fireEvent.pointerUp(strip, { clientX: 215, pointerId: 1 });
    await waitFor(() => {
      expect(searchedDays(app)).toEqual([at(21)]);
    });
  });

  it("jumps to the lowest day and searches it", async () => {
    const app = setup("en");
    const prices = Array.from({ length: 30 }, (_, n) => 8000 + n * 50);
    prices[7] = 4321;
    save(app, prices);
    const jump = await screen.findByRole("button", { name: /Jump to lowest/ });
    await waitFor(() => {
      expect(jump).toHaveTextContent("NT$ 4,321");
    });
    fireEvent.click(jump);
    const strip = await slider("en");
    expect(strip).toHaveAttribute("aria-valuenow", "7");
    await waitFor(() => {
      expect(searchedDays(app)).toEqual([at(7)]);
    });
  });

  it.each(["en", "zh-TW"] as const)(
    "names the four colours in a legend in %s",
    async (language) => {
      const app = setup(language);
      save(
        app,
        Array.from({ length: 30 }, (_, n) => 6000 + n),
      );
      await slider(language);
      const region = await dock(language);
      expect(
        within(region).getByRole("button", { name: new RegExp(text[language].jump) }),
      ).toBeVisible();
      for (const name of text[language].legend)
        expect(within(region).getByText(name)).toBeVisible();
    },
  );

  it.each(["en", "zh-TW"] as const)(
    "shows how much cheaper another day is than the searched day in %s",
    async (language) => {
      const app = setup(language);
      save(
        app,
        Array.from({ length: 30 }, (_, n) => (n === indexOfSearched ? 7000 : 6000)),
      );
      const strip = await slider(language);
      await waitFor(() => {
        expect(bars(strip).some((bar) => bar.dataset.kind !== "none")).toBe(true);
      });
      fireEvent.keyDown(strip, { key: indexOfSearched > 0 ? "ArrowLeft" : "ArrowRight" });
      const other = indexOfSearched > 0 ? indexOfSearched - 1 : 1;
      expect(strip).toHaveAttribute("aria-valuenow", String(other));
      expect(tip(strip)?.querySelector("[data-direction]")).toHaveAttribute(
        "data-direction",
        "down",
      );
      expect(tip(strip)?.querySelector("[data-direction]")?.textContent).toBe("1,000");
      expect(strip.getAttribute("aria-valuetext")).toContain(
        language === "en" ? "NT$ 1,000 cheaper than" : "省 NT$ 1,000",
      );
    },
  );

  it.each(["en", "zh-TW"] as const)(
    "shows grey skeleton bars that do not pulse under reduced motion, then the dock, in %s",
    async (language) => {
      const app = setup(language);
      save(app, [9000]);
      const release = app.api.holdResponses("GET /api/v1/flights/price-strip");
      const skeleton = await screen.findByRole("status", { name: text[language].loading });
      expect(skeleton.children).toHaveLength(30);
      expect(skeleton.querySelector(".strip-pulse")).toBeNull();
      release();
      await waitFor(() => {
        expect(screen.queryByRole("status", { name: text[language].loading })).toBeNull();
      });
      expect(await slider(language)).toBeVisible();
    },
  );

  it("pulses the skeleton when motion is allowed", async () => {
    window.matchMedia = (query) => ({ matches: false, media: query }) as MediaQueryList;
    const app = setup("en");
    const release = app.api.holdResponses("GET /api/v1/flights/price-strip");
    const skeleton = await screen.findByRole("status", { name: text.en.loading });
    expect(skeleton.querySelector(".strip-pulse")).not.toBeNull();
    release();
  });

  it("grows the bars in only when motion is allowed", async () => {
    const reduced = setup("en");
    save(
      reduced,
      Array.from({ length: 30 }, (_, n) => 6000 + n),
    );
    const strip = await slider("en");
    await waitFor(() => {
      expect(bars(strip).some((bar) => bar.dataset.kind !== "none")).toBe(true);
    });
    expect(strip.querySelector(".strip-grow")).toBeNull();
    // A drag waves the bars only when motion is allowed: none under reduced motion.
    strip.getBoundingClientRect = () => ({
      left: 0,
      width: 300,
      right: 300,
      top: 0,
      bottom: 96,
      height: 96,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(strip, { clientX: 55, pointerId: 1 });
    expect(bars(strip).every((bar) => bar.style.getPropertyValue("--w") === "")).toBe(true);
    fireEvent.pointerUp(strip, { pointerId: 1 });
  });

  it("grows and waves the bars when motion is allowed", async () => {
    window.matchMedia = (query) => ({ matches: false, media: query }) as MediaQueryList;
    const app = setup("en");
    save(
      app,
      Array.from({ length: 30 }, (_, n) => 6000 + n),
    );
    const strip = await slider("en");
    await waitFor(() => {
      expect(bars(strip).some((bar) => bar.dataset.kind !== "none")).toBe(true);
    });
    expect(strip.querySelector(".strip-grow")).not.toBeNull();
    strip.getBoundingClientRect = () => ({
      left: 0,
      width: 300,
      right: 300,
      top: 0,
      bottom: 96,
      height: 96,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(strip, { clientX: 55, pointerId: 1 });
    expect(bars(strip)[5]?.style.getPropertyValue("--w")).not.toBe("");
    fireEvent.pointerUp(strip, { pointerId: 1 });
    await act(async () => {});
    expect(bars(strip).every((bar) => bar.style.getPropertyValue("--w") === "")).toBe(true);
  });

  it.each(["en", "zh-TW"] as const)("says how old old prices are in %s", async (language) => {
    const app = setup(language);
    app.api.flightPriceStrip = [
      { date: at(3), price: 9000, fetchedAt: Date.now() - 30 * HOUR },
      { date: at(4), price: 8000, fetchedAt: Date.now() - 40 * HOUR },
    ];
    await slider(language);
    const region = await dock(language);
    expect(within(region).getByText(text[language].age)).toBeVisible();
  });

  it.each(["en", "zh-TW"] as const)(
    "shows a plain unavailable line, no bars and no spinner, when there are no prices in %s",
    async (language) => {
      setup(language);
      const section = await screen.findByRole("region", { name: text[language].title });
      expect(await within(section).findByText(text[language].unavailable)).toBeVisible();
      expect(screen.queryByRole("slider")).toBeNull();
      expect(screen.queryByRole("status", { name: text[language].loading })).toBeNull();
    },
  );

  it.each(["en", "zh-TW"] as const)(
    "shows the same unavailable line when the request fails in %s",
    async (language) => {
      const app = setup(language);
      app.api.failNext("GET /api/v1/flights/price-strip");
      app.api.failNext("GET /api/v1/flights/price-strip");
      const section = await screen.findByRole("region", { name: text[language].title });
      expect(await within(section).findByText(text[language].unavailable)).toBeVisible();
      expect(screen.queryByRole("status", { name: text[language].loading })).toBeNull();
    },
  );

  it("ignores an older search that answers after a newer one", async () => {
    const app = setup("en");
    save(
      app,
      Array.from({ length: 30 }, (_, n) => 6000 + n * 100),
    );
    const strip = await slider("en");
    await waitFor(() => {
      expect(bars(strip).some((bar) => bar.dataset.kind !== "none")).toBe(true);
    });
    const releaseOlder = app.api.holdNextResponse("POST /api/v1/flights/search");
    fireEvent.keyDown(strip, { key: "ArrowRight" });
    await waitFor(() => {
      expect(searchedDays(app)).toEqual([plus(searched, 1)]);
    });
    fireEvent.keyDown(strip, { key: "ArrowRight" });
    await waitFor(() => {
      expect(searchedDays(app)).toEqual([plus(searched, 1), plus(searched, 2)]);
    });
    await waitFor(() => {
      expect(app.api.calls.filter((c) => c === "POST /api/v1/flights/advise")).toHaveLength(1);
    });
    releaseOlder();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    // The strip stays on the newer day and no advice was asked for the older reply.
    expect(strip).toHaveAttribute("aria-valuenow", String(indexOfSearched + 2));
    expect(app.api.calls.filter((c) => c === "POST /api/v1/flights/advise")).toHaveLength(1);
    // The restored-last-search entry follows the newer search only.
    const remembered = Array.from({ length: localStorage.length }, (_, i) =>
      localStorage.getItem(localStorage.key(i) ?? ""),
    ).find((value) => value?.startsWith('{"origin"'));
    expect(remembered).toContain(`"departureDate":"${plus(searched, 2)}"`);
  });

  it.each([
    // Far from the searched day: ten days before it, crossing into the next month.
    { today: "2026-11-09", first: "Nov 24", last: "Dec 23", months: ["2026-11", "2026-12"] },
    // Searched day under ten days away: the window starts today, never in the past.
    { today: "2026-11-30", first: "Nov 30", last: "Dec 29", months: ["2026-11", "2026-12"] },
  ])("starts the 30 days at $first for a clock of $today, reading two months", async (c) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${c.today}T08:00:00Z`));
    const app = setup("en");
    app.api.flightPriceStrip = Array.from({ length: 60 }, (_, n) => ({
      date: plus(c.today, n),
      price: 6000 + n,
      fetchedAt: Date.now(),
    }));
    const strip = await slider("en");
    await waitFor(() => {
      expect(bars(strip).some((bar) => bar.dataset.kind !== "none")).toBe(true);
    });
    const region = await dock("en");
    expect(within(region).getByText(c.first)).toBeInTheDocument();
    expect(within(region).getByText(c.last)).toBeInTheDocument();
    expect(app.api.flightPriceStripQueries.sort()).toEqual(
      c.months.map((m) => `?origin=TPE&destination=OKA&currency=TWD&month=${m}`),
    );
  });

  it("keeps the stay and drops a theme when a day is picked live", async () => {
    const app = setup("en");
    app.api.flightPromptIntent = { ...intent, theme: "warm_island" };
    save(
      app,
      Array.from({ length: 30 }, (_, n) => 6000 + n),
    );
    fireEvent.change(await screen.findByLabelText("Where would you like to go?"), {
      target: { value: "somewhere warm" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Explore flights" }));
    await waitFor(() => {
      expect(app.api.flightSearchRequests).toHaveLength(1);
    });
    const strip = await slider("en");
    await waitFor(() => {
      expect(bars(strip).some((bar) => bar.dataset.kind !== "none")).toBe(true);
    });
    fireEvent.keyDown(strip, { key: "ArrowRight" });
    await waitFor(() => {
      expect(app.api.flightSearchRequests).toHaveLength(2);
    });
    const picked = app.api.flightSearchRequests[1];
    expect(picked).not.toHaveProperty("theme");
    expect(picked).toMatchObject({
      departureDate: plus(searched, 1),
      returnDate: plus(searched, 1 + stay),
    });
  });

  it("still draws the bars of the month that loaded when the other month fails", async () => {
    const app = setup("en");
    save(
      app,
      Array.from({ length: 30 }, (_, n) => 6000 + n),
    );
    app.api.failNext("GET /api/v1/flights/price-strip");
    const strip = await slider("en");
    await waitFor(() => {
      expect(bars(strip).some((bar) => bar.dataset.kind !== "none")).toBe(true);
    });
    const priced = bars(strip).filter((bar) => bar.dataset.kind !== "none").length;
    expect(priced).toBeGreaterThan(0);
    expect(priced).toBeLessThan(30);
    expect(screen.queryByText(text.en.unavailable)).toBeNull();
  });

  it("keeps every new text pair at 4.5:1, from the real tokens", () => {
    const css = readFileSync("src/styles.css", "utf8"); // vitest runs with apps/web as cwd
    const token = (name: string, from = css) =>
      new RegExp(`${name}\\s*:\\s*(#[0-9a-f]{6})`, "i").exec(from)?.[1] ?? "";
    const travel = /\.travel-mode\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    const tip = /\.strip-tip\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    const pairs: [string, string][] = [
      [token("\\bcolor", tip), token("--color-sprout-900")], // tooltip
      [token("--color-ink-muted", travel), token("--travel-nav", travel)], // hint, axis, legend
      [token("--color-sprout-600"), "#ffffff"], // jump button on white
    ];
    for (const [fg, bg] of pairs) {
      expect(fg).toMatch(/^#/);
      expect(bg).toMatch(/^#/);
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
