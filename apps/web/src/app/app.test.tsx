import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import { renderApp } from "../../test/render-app.js";

describe("app shell", () => {
  it("shows a signed-out visitor the landing page at /", async () => {
    renderApp();

    expect(await screen.findByRole("heading", { level: 1, name: /一筆快分/ })).toBeVisible();
    expect(screen.getAllByRole("link", { name: /登入/ })[0]).toHaveAttribute("href", "/sign-in");
  });

  it("takes a returning User straight into the app with the five tabs", async () => {
    renderApp({ cookieUser: makeUser("小宇") });

    expect(await screen.findByRole("heading", { name: /小宇/ })).toBeVisible();
    const tabs = within(screen.getByRole("navigation", { name: "底部導覽" }));
    expect(tabs.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "首頁",
      "群組",
      "新增",
      "統計",
      "設定",
    ]);
    const sidebar = within(screen.getByRole("navigation", { name: "側邊導覽" }));
    expect(sidebar.getByRole("link", { name: "群組" })).toHaveAttribute("href", "/groups");
  });

  it("sends a signed-out deep link to sign-in and back after Google sign-in", async () => {
    const user = userEvent.setup();
    const { router } = renderApp({ path: "/groups" });

    await user.click(await screen.findByRole("button", { name: "使用 Google 帳號登入" }));

    expect(await screen.findByRole("heading", { level: 1, name: "我的群組" })).toBeVisible();
    expect(router.state.location.pathname).toBe("/groups");
  });

  describe("LINE menu links (liff.state)", () => {
    it.each([
      ["%2Fnew", "/new"],
      ["%2Fgroups", "/groups"],
      ["%2F", "/"],
      ["new", "/new"],
    ])("opens the page %s asks for when already signed in", async (state, path) => {
      const { router } = renderApp({
        path: `/?liff.state=${state}`,
        cookieUser: makeUser("小宇"),
      });

      await waitFor(() => {
        expect(router.state.location.pathname).toBe(path);
      });
      expect(router.state.location.search).toBe("");
    });

    it("keeps the query of the path it opens", async () => {
      const { router } = renderApp({
        path: "/?liff.state=%2Fgroups%3Fcreate%3Drunning-tab",
        cookieUser: makeUser("小宇"),
      });

      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/groups");
      });
      expect(router.state.location.search).toBe("?create=running-tab");
    });

    it("signs a signed-out person in first and then opens the page", async () => {
      const { router } = renderApp({
        path: "/?liff.state=%2Fnew",
        insideLine: { idToken: "fake|line-1|阿芽" },
      });

      expect(await screen.findByRole("heading", { name: "記在哪個群組？" })).toBeVisible();
      expect(router.state.location.pathname).toBe("/new");
    });

    it("ignores a value that would leave the site", async () => {
      const { router } = renderApp({
        path: "/?liff.state=%2F%2Fevil.example",
        cookieUser: makeUser("小宇"),
      });

      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/");
      });
      expect(router.state.location.search).toBe("");
    });
  });

  it("signs in automatically inside LINE", async () => {
    renderApp({ insideLine: { idToken: "fake|line-1|阿芽" } });

    expect(await screen.findByRole("heading", { name: /阿芽/ })).toBeVisible();
  });

  it("offers LINE and Google outside LINE, with the data summary and consent", async () => {
    const { lineLogins } = renderApp({ path: "/sign-in" });

    await userEvent.click(await screen.findByRole("button", { name: "使用 LINE 快速登入" }));

    expect(lineLogins).toHaveLength(1);
    expect(await screen.findByRole("button", { name: "使用 Google 帳號登入" })).toBeVisible();
    expect(screen.getByText(/名稱與頭像/)).toBeVisible();
    expect(screen.getByRole("link", { name: "隱私權政策" })).toHaveAttribute("href", "/privacy");
  });

  it("hides the Google button inside LINE", async () => {
    renderApp({ path: "/sign-in", insideLine: { idToken: null } });

    expect(await screen.findByRole("button", { name: "使用 LINE 快速登入" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "使用 Google 帳號登入" })).toBeNull();
  });

  it("explains a refused sign-in in zh-TW", async () => {
    renderApp({ path: "/sign-in", insideLine: { idToken: "expired" } });

    expect(await screen.findByRole("alert")).toHaveTextContent("登入沒有成功，請再試一次。");
  });

  it("signs in through the test form only when it is enabled", async () => {
    const user = userEvent.setup();
    renderApp({ path: "/sign-in", testSignIn: true });

    await user.type(await screen.findByLabelText("顯示名稱"), "測試員");
    await user.click(screen.getByRole("button", { name: "測試登入" }));

    expect(await screen.findByRole("heading", { name: /測試員/ })).toBeVisible();
  });

  it("has no test form when it is disabled", async () => {
    renderApp({ path: "/sign-in" });

    expect(await screen.findByRole("button", { name: "使用 LINE 快速登入" })).toBeVisible();
    expect(screen.queryByLabelText("顯示名稱")).toBeNull();
  });

  it("returns to the landing page after signing out", async () => {
    const user = userEvent.setup();
    renderApp({ path: "/settings", cookieUser: makeUser("小宇") });

    await user.click(await screen.findByRole("button", { name: "登出" }));

    expect(await screen.findByRole("heading", { level: 1, name: /一筆快分/ })).toBeVisible();
  });
});
