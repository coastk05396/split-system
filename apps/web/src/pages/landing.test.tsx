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
  });

  it("lets visitors filter live floating deals and toggle to English on the landing page", async () => {
    const user = userEvent.setup();
    renderApp({ path: "/landing" });

    const board = await screen.findByRole("region", { name: "今日浮動特價機票" });
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
  });
});
