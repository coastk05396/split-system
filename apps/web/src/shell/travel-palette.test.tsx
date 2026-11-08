import { readFileSync } from "node:fs";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { contrast } from "../../test/contrast.js";
import { makeUser } from "../../test/fake-api.js";
import { openSearchPanel } from "../../test/flight-panel.js";
import { renderApp } from "../../test/render-app.js";

const css = readFileSync("src/styles.css", "utf8"); // vitest runs with apps/web as cwd

const declarations = (block: string) =>
  Object.fromEntries(
    [...block.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1], m[2]]),
  ) as Record<string, string>;

const theme = declarations(/@theme\s*\{([^}]*)\}/.exec(css)?.[1] ?? "");
const travel = declarations(/\.travel-mode\s*\{([^}]*)\}/.exec(css)?.[1] ?? "");
const token = (name: string) => travel[name] ?? theme[name] ?? "#ffffff";

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

  it("puts the palette on <html> so the body-mounted Price Watch dialog inherits it, and drops it on leaving", async () => {
    const { router } = renderApp({ path: "/travel/flights", cookieUser: makeUser("Rick") });
    await screen.findByRole("heading", { name: "下一站，沖繩！" });
    await openSearchPanel();
    fireEvent.change(screen.getByLabelText("目的地機場"), { target: { value: "NRT" } });
    fireEvent.change(screen.getByLabelText("出發日期"), { target: { value: "2027-01-08" } });
    fireEvent.change(screen.getByLabelText("回程日期"), { target: { value: "2027-01-11" } });
    fireEvent.click(screen.getByRole("button", { name: "搜尋航班" }));
    fireEvent.click(await screen.findByRole("button", { name: "降價叫醒我" }));
    const dialog = await screen.findByRole("dialog", { name: "降價叫醒我" });
    expect(dialog.closest(".travel-mode")).toBe(document.documentElement);
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "底部導覽" })).getByRole("link", {
        name: "分帳",
      }),
    );
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
    expect(document.documentElement).not.toHaveClass("travel-mode");
  });

  it("removes the palette from <html> when the app unmounts", async () => {
    renderApp({ path: "/travel/flights", cookieUser: makeUser("Rick") });
    await screen.findByRole("heading", { name: "下一站，沖繩！" });
    expect(document.documentElement).toHaveClass("travel-mode");
    cleanup();
    expect(document.documentElement).not.toHaveClass("travel-mode");
  });

  it("keeps a pending 取消追蹤 solid green, every pair at 4.5:1", async () => {
    const { api } = renderApp({ path: "/travel/watches", cookieUser: makeUser("Rick") });
    api.flightWatches = [
      {
        id: "w1",
        status: "active",
        channel: "web_push",
        intent: {
          origin: "TPE",
          destination: "NRT",
          departureDate: "2027-01-08",
          returnDate: "2027-01-11",
          currency: "TWD",
          excludeRedEye: false,
          directOnly: false,
        },
        baselineFare: 20000,
        targetFare: 17000,
        latestFare: null,
        checkedAt: null,
        createdAt: 1,
      },
    ];
    const release = api.holdResponses("DELETE /api/v1/flights/watches/w1");
    const cancel = await screen.findByRole("button", { name: "取消追蹤" });
    fireEvent.click(cancel);
    await waitFor(() => {
      expect(cancel).toBeDisabled();
    });
    expect(cancel).toHaveClass("secondary-button");
    const rule = /\.travel-mode \.secondary-button:disabled\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/opacity:\s*1\b/);
    expect(rule).toMatch(/background-color:\s*var\(--color-travel-disabled\)/);
    expect(rule).toMatch(/color:\s*var\(--color-travel-disabled-ink\)/);
    expect(
      contrast(token("--color-travel-disabled-ink"), token("--color-travel-disabled")),
    ).toBeGreaterThanOrEqual(4.5);
    release();
  });

  it("leaves a disabled secondary button outside /travel dimmed, with no travel colours", async () => {
    const api = renderApp({
      path: "/join/tok-1",
      cookieUser: makeUser("小宇"),
      seed: (groups) => {
        groups.add(makeUser("ty"), {
          name: "台南",
          others: [{ name: "阿哲", status: "placeholder" }],
          invite: { token: "tok-1" },
        });
      },
    }).api;
    const release = api.holdResponses("POST /api/v1/invites/tok-1/join");
    const button = await screen.findByRole("button", { name: "我不是，以新成員加入" });
    fireEvent.click(button);
    await waitFor(() => {
      expect(button).toBeDisabled();
    });
    expect(document.documentElement).not.toHaveClass("travel-mode");
    expect(button).toHaveClass("disabled:opacity-50");
    expect(button.className).not.toMatch(/travel/);
    release();
  });

  it("does not interpolate button colours in Travel mode, so no in-between frame drops under 4.5:1", () => {
    const rule = /\.travel-mode \.press-pill\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    const property = /transition-property:\s*([^;]*);/.exec(rule)?.[1] ?? "";
    expect(property).toMatch(/\btransform\b/);
    expect(property).not.toMatch(/color|border|opacity|\ball\b/);
    // The shared rule still animates colour everywhere else.
    expect(/\.press-pill,[^{]*\{[^}]*transition-property:[^;]*color/.test(css)).toBe(true);
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
