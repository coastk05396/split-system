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

  it("sets the mock's fonts under Travel mode with the existing stack as fallback", () => {
    const travel = [...css.matchAll(/\.travel-mode\s+body\s*\{([^}]*)\}/g)].map((m) => m[1]).join();
    const family = /font-family:\s*([^;]+);/.exec(travel)?.[1] ?? "";
    expect(family).toMatch(/^"Schibsted Grotesk",\s*"Noto Sans TC",\s*var\(--font-sans\)/);
    expect(/--font-sans:\s*\n?\s*"PingFang TC"/.test(css)).toBe(true); // the fallback stays
  });

  it("draws paper grain behind the Travel page, so no text sits under it", () => {
    const grain = /\.travel-mode\s+body::before\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(grain).toContain("feTurbulence");
    expect(grain).toMatch(/pointer-events:\s*none/);
    expect(grain).toMatch(/z-index:\s*-1/);
    expect(grain).toMatch(/position:\s*fixed/);
  });

  it("cuts ticket notches into fare cards in the page colour, leaving card and text colours alone", () => {
    const shared = /\.fare::before,\s*\.fare::after\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    const left = shared + rule(".fare::before");
    const right = shared + rule(".fare::after");
    for (const side of [left, right]) {
      expect(side).toMatch(/border-radius:\s*50%/);
      expect(side).toMatch(/pointer-events:\s*none/);
      expect(side).toContain("var(--travel-page)");
      expect(side).toMatch(/clip-path:\s*inset/);
    }
    expect(left).toMatch(/left:\s*-/);
    expect(right).toMatch(/right:\s*-/);
    // Notches stay inside the card's 16 px padding, so no text is covered.
    const half = Number(/width:\s*(\d+)px/.exec(left)?.[1]) / 2;
    expect(half).toBeLessThan(16);
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
