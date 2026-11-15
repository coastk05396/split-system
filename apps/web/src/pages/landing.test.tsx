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
  });

  it("lets visitors filter live floating deals and toggle to English on the landing page", async () => {
    const user = userEvent.setup();
    const { api } = renderApp({ path: "/landing" });
    api.dailyFlights = { ...api.dailyFlights, isFallback: true };

    const board = await screen.findByRole("region", { name: "今日浮動特價機票" });
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
      await screen.findByText("Showing curated preview deals while live data syncs."),
    ).toBeVisible();
  });
});
