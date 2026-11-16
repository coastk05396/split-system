import { screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import { renderApp } from "../../test/render-app.js";

describe("public landing route", () => {
  it.each([false, true])("shows the editorial page when signed in is %s", async (signedIn) => {
    const { router } = renderApp({
      path: "/landing",
      ...(signedIn ? { cookieUser: makeUser("小宇") } : {}),
    });
    expect(
      await screen.findByRole("heading", { level: 1, name: "搶低價機票，出遊好分帳。" }),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe("/landing");
    expect(screen.queryByRole("navigation", { name: "側邊導覽" })).toBeNull();
    expect(screen.getByRole("link", { name: /逛完整機票看板/ })).toHaveAttribute(
      "href",
      "/flights",
    );
    expect(screen.getByRole("region", { name: "今日浮動特價機票" })).toBeVisible();

    // Only one /flights CTA (Hero) & one sign-in entry (top header)
    expect(screen.getAllByRole("link", { name: "登入" })).toHaveLength(1);
    expect(screen.queryByRole("link", { name: "登入開始使用" })).toBeNull();
    expect(screen.queryByRole("link", { name: "低價機票" })).toBeNull();
    expect(screen.queryByText(/低價機票雷達 × 出遊分帳/)).toBeNull();
    expect(screen.queryByText(/不用註冊就能逛/)).toBeNull();

    // Concise 2-step visual guide without 01/02/03 AI bento cards or Trip.com text
    expect(screen.getByText("挑台灣低價機票")).toBeVisible();
    expect(screen.getByText("回小芽一鍵分帳")).toBeVisible();
    expect(screen.queryByRole("heading", { level: 3, name: "每日低價雷達" })).toBeNull();
    expect(document.body.textContent).not.toMatch(/Trip\.com/i);

    // Hero uses the app's sans heading font, and the footer drops the tagline
    const hero = screen.getByRole("heading", { level: 1 });
    expect(hero.className).not.toContain("font-serif");
    expect(hero.className).toContain("font-black");
    expect(screen.queryByText(/不經手任何款項/)).toBeNull();
    expect(screen.getByRole("link", { name: "服務條款" })).toBeVisible();
  });

  it("shows the same city cards as /flights: city-only name, route chip, fare count, solid pill only on the top 3", async () => {
    const { api } = renderApp({ path: "/landing" });
    const board = await screen.findByRole("region", { name: "今日浮動特價機票" });
    const cards = await within(board).findAllByRole("heading", { level: 2 });
    expect(cards.length).toBeLessThanOrEqual(5); // shared title + at most 4 cards
    expect(board.textContent).not.toMatch(/東京成田|大阪關西|首爾仁川/);
    // Same shared title block as /flights, as an h2 under the page's h1
    expect(within(board).getByRole("heading", { level: 2, name: "今日低價機票" })).toBeVisible();
    expect(within(board).getByText("每天 08:00 更新")).toBeVisible();
    expect(board.textContent).toMatch(/筆/);
    expect(board.textContent).not.toMatch(/•/);
    expect(board.querySelectorAll(".bg-sprout-600").length).toBeLessThanOrEqual(3);
    expect(api.dailyFlights).toBeDefined();
  });

  it("lets visitors filter live floating deals and toggle to English on the landing page", async () => {
    const user = userEvent.setup();
    const { api } = renderApp({ path: "/landing" });
    api.dailyFlights = { ...api.dailyFlights, isFallback: true };

    const board = await screen.findByRole("region", { name: "今日浮動特價機票" });
    const heroSection = board.closest("main")?.querySelector("section");
    expect(heroSection).toHaveClass("grid-cols-1", "lg:grid-cols-[0.95fr_1.05fr]");
    expect(board).toHaveClass("min-w-0");
    expect(board.querySelector("li")).toHaveClass("min-w-0");
    expect(board.querySelectorAll("svg[data-country]").length).toBeGreaterThan(0);
    expect(board.textContent).not.toMatch(/Trip\.com/i);

    await user.click(within(board).getByRole("button", { name: "日本" }));
    expect(within(board).getAllByText(/東京|大阪|沖繩|札幌|福岡/)[0]).toBeVisible();

    await user.click(screen.getByRole("button", { name: "切換為英文" }));
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Catch cheap flights. Split the trip easily.",
      }),
    ).toBeVisible();
    expect(screen.getByText("Sprout")).toBeVisible();
    expect(
      await screen.findByText(
        "Showing curated preview deals; daily fares refresh at 08:00 (GMT+8).",
      ),
    ).toBeVisible();
  });
});
