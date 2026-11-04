import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import { renderApp } from "../../test/render-app.js";

const TOKEN = "fake|g-1|Google 小宇";

describe("/google-return (Google's account chooser sends the page back)", () => {
  it("signs in and goes where the sign-in was headed", async () => {
    renderApp({
      path: "/google-return",
      googleRedirectResult: { errand: { purpose: "signIn", next: "/groups" }, idToken: TOKEN },
    });

    expect(await screen.findByRole("heading", { level: 1, name: "我的群組" })).toBeVisible();
  });

  it("links Google to the signed-in User and opens settings", async () => {
    renderApp({
      path: "/google-return",
      cookieUser: makeUser("小宇", "line"),
      googleRedirectResult: { errand: { purpose: "link" }, idToken: TOKEN },
    });

    await screen.findByRole("heading", { level: 1, name: "我的設定" });
    const accounts = within(screen.getByRole("list", { name: "已連結的帳號" }));
    expect(accounts.getByText("Google").closest("li")).toHaveTextContent("已連結");
  });

  it("does not let a link code replace a live session: it goes back to the log-out wall", async () => {
    const { api } = renderApp({
      path: "/google-return",
      cookieUser: makeUser("甲", "line"),
      googleRedirectResult: { errand: { purpose: "linkCode", code: "code-1" }, idToken: TOKEN },
    });
    api.linkCodes.set("code-1", makeUser("乙", "line"));

    expect(await screen.findByText(/請先登出/)).toBeVisible();
    expect(api.calls).not.toContain("POST /api/v1/auth/link-code/redeem");
  });

  it("puts a person who refused back on the page they started from", async () => {
    renderApp({
      path: "/google-return",
      cookieUser: makeUser("小宇", "line"),
      googleRedirectResult: { errand: { purpose: "link" }, idToken: null },
    });

    expect(await screen.findByRole("heading", { level: 1, name: "我的設定" })).toBeVisible();
  });

  it("an address with no readable answer goes to sign-in", async () => {
    renderApp({ path: "/google-return" });

    expect(await screen.findByRole("button", { name: "使用 LINE 快速登入" })).toBeVisible();
  });
});
