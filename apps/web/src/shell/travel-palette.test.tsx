import { readFileSync } from "node:fs";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp } from "../../test/render-app.js";
import { makeUser } from "../../test/fake-api.js";

const css = readFileSync("src/styles.css", "utf8"); // vitest runs with apps/web as cwd

const declarations = (block: string) =>
  Object.fromEntries(
    [...block.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1], m[2]]),
  ) as Record<string, string>;

const theme = declarations(/@theme\s*\{([^}]*)\}/.exec(css)?.[1] ?? "");
const travel = declarations(/\.travel-mode\s*\{([^}]*)\}/.exec(css)?.[1] ?? "");
const token = (name: string) => travel[name] ?? theme[name] ?? "#ffffff";

const channel = (hex: string, i: number) => {
  const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) =>
  0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2);
const contrast = (a: string, b: string) => {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

describe("Travel mode green palette", () => {
  it("scopes the palette to the travel pages and leaves the normal palette elsewhere", async () => {
    const travelView = renderApp({ path: "/travel/flights", cookieUser: makeUser("Rick") });
    const bottom = await screen.findByRole("navigation", { name: "底部導覽" });
    expect(bottom.closest(".travel-mode")).not.toBeNull();
    expect(
      screen.getByRole("navigation", { name: "側邊導覽" }).closest(".travel-mode"),
    ).not.toBeNull();
    fireEvent.click(within(bottom).getByRole("link", { name: "分帳" }));
    await waitFor(() => {
      expect(travelView.router.state.location.pathname).toBe("/");
    });
    const home = await screen.findByRole("navigation", { name: "底部導覽" });
    expect(home.closest(".travel-mode")).toBeNull();
  });

  it("keeps every text and background pair at 4.5:1 or better", () => {
    expect(travel["--travel-page"]).toBeDefined();
    expect(travel["--travel-nav"]).toBeDefined();
    const page = token("--travel-page");
    const nav = token("--travel-nav");
    const pairs: [string, string][] = [
      [token("--color-ink"), page],
      [token("--color-ink-muted"), page],
      [token("--color-ink-muted"), nav],
      [token("--color-sprout-700"), token("--color-sprout-150")],
      ["#ffffff", token("--color-sprout-600")],
      ["#ffffff", token("--color-sprout-900")],
    ];
    for (const [fg, bg] of pairs) expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
