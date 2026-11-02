import { screen } from "@testing-library/react";
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
      await screen.findByRole("heading", { level: 1, name: "一筆快分，一趟好玩。" }),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe("/landing");
    expect(screen.queryByRole("navigation", { name: "側邊導覽" })).toBeNull();
  });
});
