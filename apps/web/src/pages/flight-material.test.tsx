import { readFileSync } from "node:fs";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { contrast } from "../../test/contrast.js";
import { makeUser } from "../../test/fake-api.js";
import { openSearchPanel } from "../../test/flight-panel.js";
import { renderApp } from "../../test/render-app.js";

const css = readFileSync("src/styles.css", "utf8"); // vitest runs with apps/web as cwd
const rule = (selector: string) =>
  new RegExp(
    `(?:^|(?<!,)\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
  ).exec(css)?.[1] ?? "";
const token = (name: string) =>
  new RegExp(`${name}\\s*:\\s*(#[0-9a-f]{6})`, "i").exec(css)?.[1] ?? "";
const fontLink = () =>
  document.head.querySelector<HTMLLinkElement>('link[rel="stylesheet"][href*="fonts.googleapis"]');

describe("Flight Radar material and type", () => {
  it("loads the reference fonts from Google Fonts on Travel pages only, with preconnect and swap", async () => {
    const { router } = renderApp({ path: "/travel/flights", cookieUser: makeUser("Rick") });
    await screen.findByRole("heading", { name: "下一站，沖繩！" });
    const href = fontLink()?.href ?? "";
    expect(href).toContain("family=Schibsted+Grotesk");
    expect(href).toContain("family=Noto+Sans+TC");
    expect(href).toContain("display=swap");
    const origins = [...document.head.querySelectorAll('link[rel="preconnect"]')].map(
      (l) => (l as HTMLLinkElement).href,
    );
    expect(origins).toContain("https://fonts.googleapis.com/");
    expect(origins).toContain("https://fonts.gstatic.com/");
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "底部導覽" })).getByRole("link", {
        name: "分帳",
      }),
    );
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
    expect(fontLink()).toBeNull();
    expect(document.head.querySelector('link[rel="preconnect"]')).toBeNull();
  });

  it("does not load them on a non-Travel screen", async () => {
    renderApp({ path: "/", cookieUser: makeUser("Rick") });
    await screen.findByRole("navigation", { name: "底部導覽" });
    expect(fontLink()).toBeNull();
  });

  it("sets exactly the mock's font stack under Travel mode", () => {
    const travel = [...css.matchAll(/\.travel-mode\s+body\s*\{([^}]*)\}/g)].map((m) => m[1]).join();
    const family = /font-family:\s*([^;]+);/.exec(travel)?.[1] ?? "";
    expect(family).toBe('"Schibsted Grotesk", "Noto Sans TC", sans-serif');
    expect(/--font-sans:\s*\n?\s*"PingFang TC"/.test(css)).toBe(true); // the app stack stays for the rest of the app
  });

  it("lays the mock's grid under the cards and its paper grain over the page, as the mock does", () => {
    const grid = /\.travel-mode\s+body::before\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(grid).toMatch(/background-size:\s*28px 28px/);
    expect(grid).toMatch(/z-index:\s*-1/);
    expect(grid).toMatch(/pointer-events:\s*none/);
    const grain = /\.travel-mode\s+body::after\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(grain).toContain("feTurbulence");
    expect(grain).toMatch(/pointer-events:\s*none/);
    expect(grain).toMatch(/mix-blend-mode:\s*multiply/);
    expect(grain).toMatch(/opacity:\s*0\.07/);
    // Above the content (the mock's z-index 30) but under dialogs (z-70).
    expect(Number(/z-index:\s*(\d+)/.exec(grain)?.[1])).toBeGreaterThan(9);
    expect(Number(/z-index:\s*(\d+)/.exec(grain)?.[1])).toBeLessThan(70);
    // The grid's z-index:-1 lands above body's background only when body is its own stacking context.
    const body = [...css.matchAll(/\.travel-mode\s+body\s*\{([^}]*)\}/g)].map((m) => m[1]).join();
    expect(body).toMatch(/isolation:\s*isolate/);
  });

  it("keeps muted Travel text at 4.5:1 with the grain over both text and page at its darkest", () => {
    const grain = /\.travel-mode\s+body::after\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    const opacity = Number(/opacity:\s*([\d.]+)/.exec(grain)?.[1]);
    const noise = [0.08, 0.25, 0.16]; // the feColorMatrix colour at full alpha: the darkest the grain gets
    const travel = /\.travel-mode\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    const page = /--travel-page:\s*(#[0-9a-f]{6})/i.exec(travel)?.[1] ?? "";
    const muted = /--color-ink-muted:\s*(#[0-9a-f]{6})/i.exec(travel)?.[1] ?? "";
    // Multiply darkens every channel by (1 - opacity * (1 - noise)), text and background alike.
    const under = (hex: string) =>
      noise
        .map((c, i) =>
          Math.round(parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) * (1 - opacity * (1 - c))),
        )
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
    expect(opacity).toBeGreaterThan(0);
    expect(contrast(`#${under(muted)}`, `#${under(page)}`)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(`#${under(muted)}`, `#${under("#ffffff")}`)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the currency-prefix colour at 4.5:1 and the Deal Signal pill rules gone", () => {
    expect(css).not.toMatch(/\.fr-sig-(buy|hold)/);
    // The currency prefix is an opaque muted colour, never the mock's .55 opacity (3.19:1).
    const prefix = /\.fr-ff small\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(prefix).not.toMatch(/opacity/);
    expect(prefix).toMatch(/color:\s*var\(--color-ink-muted\)/);
  });

  it("keeps one 90 degree turn on the fare plane", () => {
    expect(/\.fr-path svg\s*\{([^}]*)\}/.exec(css)?.[1]).not.toMatch(/rotate/);
    expect(/\.fare-plane\s*\{([^}]*)\}/.exec(css)?.[1]).toMatch(/rotate:\s*90deg/);
  });

  it("cuts ticket notches into the form's perforation in the page colour, inside the card padding", () => {
    const shared = /\.fr-perf::before,\s*\.fr-perf::after\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    const left = shared + rule(".fr-perf::before");
    const right = shared + rule(".fr-perf::after");
    for (const side of [left, right]) {
      expect(side).toMatch(/border-radius:\s*50%/);
      expect(side).toContain("var(--travel-page)");
      expect(side).toMatch(/clip-path:\s*inset/);
    }
    expect(left).toMatch(/left:\s*-/);
    expect(right).toMatch(/right:\s*-/);
    // The mock's fare cards have no notches.
    expect(css).not.toMatch(/\.fr-fare::before|\.fare::before/);
  });

  it("gives every mock-sized control a 44 px hit area, and the 360 px calendar 44 px days", () => {
    const hit = rule(".fr-hit::before");
    expect(hit).toMatch(/width:\s*max\(100%,\s*44px\)/);
    expect(hit).toMatch(/height:\s*max\(100%,\s*44px\)/);
    // Under 390 px the calendar bleeds into the card padding: (360 - 2*18 - 2*16 + 2*16 - 6*2) / 7 = 44.3 px.
    const narrow =
      /@media \(max-width: 389px\)\s*\{\s*\.fr-cal-in\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(narrow).toMatch(/margin-inline:\s*-16px/);
    const days = (360 - 2 * 18 - 2 * 16 + 2 * 16 - 6 * 2) / 7;
    expect(days).toBeGreaterThanOrEqual(44);
  });

  it("puts a shine on both search buttons, animated only when motion is welcome", async () => {
    renderApp({ path: "/travel/flights", cookieUser: makeUser("Rick") });
    await screen.findByRole("heading", { name: "下一站，沖繩！" });
    await openSearchPanel();
    expect(screen.getByRole("button", { name: "搜尋航班" })).toHaveClass("shine");
    const static_ = rule(".shine::after");
    expect(static_).not.toMatch(/animation/);
    const motion = /@media \(prefers-reduced-motion: no-preference\)\s*\{([\s\S]*?)\n\}\n/g;
    const animated = [...css.matchAll(motion)].map((m) => m[1]).join("\n");
    expect(animated).toMatch(/\.shine::after\s*\{[^}]*animation:\s*shine/);
    expect(css).toContain("@keyframes shine");
  });

  it("keeps white button text at 4.5:1 even under the sweep's brightest point", () => {
    const peak = /rgb\(255 255 255 \/ ([\d.]+)\) 50%/.exec(rule(".shine::after"))?.[1];
    const alpha = Number(peak);
    expect(alpha).toBeGreaterThan(0);
    const base = token("--color-travel-action");
    const blend = [1, 3, 5]
      .map((i) => Math.round(parseInt(base.slice(i, i + 2), 16) * (1 - alpha) + 255 * alpha))
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("");
    expect(contrast(`#${blend}`, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });
});
