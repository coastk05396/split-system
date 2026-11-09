import { readFileSync } from "node:fs";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { contrast } from "../../test/contrast.js";
import { makeUser } from "../../test/fake-api.js";
import { renderApp } from "../../test/render-app.js";

const text = {
  en: {
    ticker: "Fare ticker",
    nrt: "Tokyo, NT$ 6,500",
    kixDeal: "Osaka, NT$ 7,000, 20% below the usual price",
    headline: "Next stop, Tokyo!",
    globe: "Globe turned to Tokyo",
    okaLeg: "655 km · ≈ 1 h 19 min",
    nrtLeg: "2,182 km · ≈ 3 h 14 min",
  },
  "zh-TW": {
    ticker: "低價跑馬燈",
    nrt: "東京，NT$ 6,500",
    kixDeal: "大阪，NT$ 7,000，比平常便宜 20%",
    headline: "下一站，東京！",
    globe: "地球儀轉向東京",
    okaLeg: "655 公里・約 1 小時 19 分",
    nrtLeg: "2,182 公里・約 3 小時 14 分",
  },
} as const;
type Language = keyof typeof text;

const chips = [
  { destination: "NRT", price: 6500 },
  { destination: "KIX", price: 7000, percentBelow: 20 },
];
const reduced = window.matchMedia.bind(window);
afterEach(() => {
  window.matchMedia = reduced;
});
const allowMotion = () => {
  window.matchMedia = (query) => ({ matches: false, media: query }) as MediaQueryList;
};
function setup(language: Language, withChips = true) {
  const app = renderApp({
    path: "/travel/flights",
    cookieUser: { ...makeUser("Rick"), language },
  });
  if (withChips) app.api.flightTicker = chips;
  return app;
}
const ticker = (language: Language) => screen.findByRole("region", { name: text[language].ticker });

describe("Flight Radar Fare Ticker", () => {
  it.each(["en", "zh-TW"] as const)(
    "shows the saved cheapest fare per destination, -N% only with history, never searching, in %s",
    async (language) => {
      const app = setup(language);
      const section = await ticker(language);
      const nrt = await within(section).findByRole("button", { name: text[language].nrt });
      expect(nrt).toHaveTextContent("NRT");
      expect(nrt).toHaveTextContent("NT$ 6,500");
      expect(nrt).not.toHaveTextContent("%");
      const kix = within(section).getByRole("button", { name: text[language].kixDeal });
      expect(kix).toHaveTextContent("−20%");
      expect(app.api.flightTickerQueries).toEqual(["?origin=TPE&currency=TWD"]);
      expect(app.api.calls).not.toContain("POST /api/v1/flights/search");
    },
  );

  it("sits above the header and renders nothing without saved fares", async () => {
    setup("en");
    const section = await ticker("en");
    const heading = screen.getByRole("heading", { level: 1 });
    expect(
      section.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    cleanup();
    setup("en", false);
    await screen.findByRole("heading", { level: 1 });
    await waitFor(() => {
      expect(screen.queryByRole("region", { name: text.en.ticker })).toBeNull();
    });
  });

  it.each(["en", "zh-TW"] as const)(
    "sets the destination when a chip is tapped, without searching, in %s",
    async (language) => {
      const app = setup(language);
      fireEvent.click(await screen.findByRole("button", { name: text[language].nrt }));
      expect(await screen.findByRole("heading", { name: text[language].headline })).toBeVisible();
      expect(await screen.findByRole("img", { name: text[language].globe })).toBeVisible();
      // The current chip takes the action fill from CSS, keyed on aria-current.
      expect(screen.getByRole("button", { name: text[language].nrt })).toHaveAttribute(
        "aria-current",
        "true",
      );
      expect(app.api.calls).not.toContain("POST /api/v1/flights/search");
    },
  );

  it("is static under reduced motion and loops, pausing on hover, otherwise", async () => {
    setup("en");
    const still = await ticker("en");
    // The test environment asks for reduced motion: one copy, no animation, scrollable by hand.
    expect(still.querySelectorAll("button")).toHaveLength(2);
    expect(still.querySelector(".fr-track")).toBeNull();
    expect(still).toHaveClass("overflow-x-auto");
  });

  it("loops with a hidden second copy when motion is allowed", async () => {
    allowMotion();
    setup("en");
    const moving = await ticker("en");
    const track = moving.querySelector(".fr-track");
    expect(track).not.toBeNull();
    // The copy that makes the loop seamless is invisible to assistive tech and the keyboard.
    expect(within(moving).getAllByRole("button")).toHaveLength(2);
    expect(track?.querySelectorAll("[aria-hidden='true'] button[tabindex='-1']")).toHaveLength(2);
  });
});

describe("Flight Radar header", () => {
  it.each(["en", "zh-TW"] as const)(
    "holds the 118 px globe at the top right with the distance and flight time, in %s",
    async (language) => {
      setup(language, false);
      const heading = await screen.findByRole("heading", { level: 1 });
      const header = heading.closest("header") as HTMLElement;
      const globe = await within(header).findByRole("img");
      expect(globe).toHaveAttribute("height", "200");
      expect(globe.style.height).toBe("118px");
      expect(
        heading.compareDocumentPosition(globe) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(within(header).getByText(text[language].okaLeg)).toBeInTheDocument();
      // The route card no longer carries the globe or the readout.
      const card = screen.getByRole("region", {
        name: language === "en" ? "Search summary" : "搜尋摘要",
      });
      expect(within(card).queryByRole("img")).toBeNull();
      expect(within(card).queryByText(text[language].okaLeg)).toBeNull();
    },
  );

  it("jumps the readouts under reduced motion and rolls them otherwise", async () => {
    setup("en");
    await screen.findByText(text.en.okaLeg);
    const km = () => document.querySelector("[data-leg='km']")?.textContent;
    expect(km()).toBe("655");
    allowMotion();
    fireEvent.click(await screen.findByRole("button", { name: text.en.nrt }));
    // Rolling: the first frame is not yet the new route, and it ends on it.
    expect(km()).not.toBe("2,182");
    await waitFor(() => {
      expect(km()).toBe("2,182");
    });
    expect(document.querySelector("[data-leg='time']")?.textContent).toBe("3h 14m");
    expect(screen.getByText(text.en.nrtLeg)).toBeInTheDocument();
  });

  it("jumps straight to the new route under reduced motion", async () => {
    setup("en");
    fireEvent.click(await screen.findByRole("button", { name: text.en.nrt }));
    await waitFor(() => {
      expect(document.querySelector("[data-leg='km']")?.textContent).toBe("2,182");
    });
  });

  it("keeps the globe put for input it does not know", async () => {
    setup("en", false);
    const globe = await screen.findByRole("img", { name: "Globe turned to Okinawa" });
    const header = globe.closest("header");
    fireEvent.click(await screen.findByRole("button", { name: /^Taipei Taoyuan → Okinawa/ }));
    fireEvent.change(await screen.findByLabelText("Destination airport"), {
      target: { value: "Atlantis" },
    });
    expect(await screen.findByRole("img", { name: "Globe turned to Okinawa" })).toBe(globe);
    expect(globe.closest("header")).toBe(header);
  });
});

describe("Fare Ticker and header contrast", () => {
  const css = readFileSync("src/styles.css", "utf8"); // vitest runs with apps/web as cwd
  const declarations = (block: string) =>
    Object.fromEntries(
      [...block.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1], m[2]]),
    ) as Record<string, string>;
  const theme = declarations(/@theme\s*\{([^}]*)\}/.exec(css)?.[1] ?? "");
  const travel = declarations(/\.travel-mode\s*\{([^}]*)\}/.exec(css)?.[1] ?? "");
  const token = (name: string) => travel[name] ?? theme[name] ?? "#ffffff";

  it("keeps every new text pair at 4.5:1 or better", () => {
    const page = token("--travel-page");
    const pairs: [string, string][] = [
      // Chip text (muted, deal green, code in ink) over the page and over a hovered glass chip.
      [token("--color-ink-muted"), page],
      [token("--color-ink-muted"), "#ffffff"],
      [token("--color-sprout-600"), page],
      [token("--color-sprout-600"), "#ffffff"],
      [token("--color-sprout-900"), page],
      // The current chip.
      ["#ffffff", token("--color-travel-action")],
      // The distance and time readouts.
      [token("--color-ink"), page],
    ];
    for (const [fg, bg] of pairs) expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
