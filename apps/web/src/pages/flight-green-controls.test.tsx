import { readFileSync } from "node:fs";
import type { FlightSearchIntent } from "@split/shared";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { contrast } from "../../test/contrast.js";
import { makeUser } from "../../test/fake-api.js";
import { openSearchPanel } from "../../test/flight-panel.js";
import { renderApp } from "../../test/render-app.js";

const css = readFileSync("src/styles.css", "utf8"); // vitest runs with apps/web as cwd
const theme = Object.fromEntries(
  [
    ...(/@theme\s*\{([^}]*)\}/.exec(css)?.[1] ?? "").matchAll(
      /(--[\w-]+)\s*:\s*(#[0-9a-f]{6})\s*;/gi,
    ),
  ].map((m) => [m[1], m[2]]),
) as Record<string, string>;
const color = (name: string) => theme[name] ?? "#ffffff";

const intent: FlightSearchIntent = {
  origin: "TPE",
  destination: "OKA",
  departureDate: "2027-01-08",
  returnDate: "2027-01-11",
  currency: "TWD",
  excludeRedEye: false,
  directOnly: false,
};
const fare = (airline: string, price: number, departureDate: string, top: boolean) => ({
  price,
  airline,
  departureDate,
  returnDate: "2027-01-11",
  outboundDeparture: "08:00",
  outboundArrival: "12:00",
  inboundDeparture: "18:00",
  inboundArrival: "20:00",
  stops: 0,
  durationMinutes: 180,
  priceLevel: "low" as const,
  top,
});

function setup() {
  const app = renderApp({ path: "/travel/flights", cookieUser: makeUser("Rick") });
  app.api.flightPromptIntent = intent;
  app.api.flightFares = [
    fare("Cheap Air", 21000, "2027-01-07", true),
    fare("Start Air", 25000, "2027-01-08", true),
    fare("Late Air", 30000, "2027-01-09", false),
  ];
  return app;
}

async function explore() {
  setup();
  fireEvent.change(await screen.findByLabelText("想去哪裡？"), { target: { value: "okinawa" } });
  fireEvent.click(screen.getByRole("button", { name: "探索航班" }));
  await screen.findByText("Cheap Air");
}

const AMBER = /#fdf0d5|#f0c978|#f2a33a|#fff8e8|#6b3f00|#ffd23f/i;

describe("Flight Radar green controls", () => {
  it("gives every primary button one green style, with hover and a solid disabled state", async () => {
    await explore();
    const buttons = [
      screen.getByRole("button", { name: "探索航班" }),
      screen.getByRole("button", { name: "重新探索航班" }),
    ];
    await openSearchPanel();
    buttons.push(
      within(screen.getByRole("region", { name: "搜尋列" })).getByRole("button", {
        name: "搜尋航班",
      }),
    );
    for (const button of buttons) {
      expect(button).toHaveClass(
        "bg-travel-action",
        "text-white",
        "hover:bg-travel-action-hover",
        "disabled:bg-travel-disabled",
        "disabled:text-travel-disabled-ink",
      );
      // Dimming with opacity would drag the label under 4.5:1.
      expect(button.className).not.toMatch(/opacity/);
    }
    expect(
      screen.getByRole("button", { name: /^台北桃園 → .* 1\/8（五）– 1\/11（一）$/ }).className,
    ).not.toMatch(/opacity/);
  });

  it("colours fare cards and tags green, with amber only on 強烈買", async () => {
    await explore();
    for (const el of document.querySelectorAll("[class]")) {
      if (!AMBER.test(el.getAttribute("class") ?? "")) continue;
      expect(
        el.closest('[data-lowest="true"], [data-strong="true"]') ?? el.closest(".sticker"),
      ).not.toBeNull();
    }
    for (const tag of screen.queryAllByText("熱門")) expect(tag.className).not.toMatch(AMBER);
  });

  it("keeps every button, tile, card and tag pair at 4.5:1 in every state", () => {
    const action = color("--color-travel-action");
    const pairs: [string, string][] = [
      ["#ffffff", action],
      ["#ffffff", color("--color-travel-action-hover")],
      [color("--color-travel-disabled-ink"), color("--color-travel-disabled")],
      [color("--color-sprout-900"), color("--color-sprout-100")], // unselected tile
      ["#6b3f00", "#fdf0d5"], // 最低 tile and 強烈買 sticker
      [color("--color-sprout-900"), "#ffffff"], // fare card price
      [color("--color-ink-muted"), "#ffffff"], // fare card meta
      [color("--color-sprout-900"), "#fff8e8"], // 強烈買 card
      [color("--color-sprout-700"), color("--color-sprout-100")], // 熱門 tag
    ];
    for (const [fg, bg] of pairs) expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
