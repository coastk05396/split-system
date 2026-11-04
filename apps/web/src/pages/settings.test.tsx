import type { Me } from "@split/shared";
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeAll, describe, expect, it } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import { renderApp } from "../../test/render-app.js";

function bothLinked(name: string): Me {
  return {
    ...makeUser(name, "line"),
    identities: [
      { provider: "line", email: null },
      { provider: "google", email: "g@example.com" },
    ],
  };
}

async function accounts() {
  await screen.findByRole("heading", { level: 1, name: "我的設定" });
  return within(screen.getByRole("list", { name: "已連結的帳號" }));
}

async function row(provider: "LINE" | "Google") {
  const item = (await accounts()).getByText(provider).closest("li");
  if (item === null) throw new Error(`No account row for ${provider}`);
  return item;
}

// The landing page is a lazy chunk whose first import can outlast findBy's 1 s under load.
beforeAll(async () => {
  await import("./LandingPage.js");
});

function landingHeading() {
  // Two API calls and a route change come first; allow for a busy machine.
  return screen.findByRole("heading", { level: 1, name: /一筆快分/ }, { timeout: 3000 });
}

describe("settings (screen 11)", () => {
  it("shows the person and which sign-in accounts are linked", async () => {
    renderApp({ path: "/settings", cookieUser: makeUser("小宇", "line") });

    expect(await screen.findByRole("heading", { level: 1, name: "我的設定" })).toBeVisible();
    expect(screen.getByText("小宇")).toBeVisible();
    expect(await row("LINE")).toHaveTextContent("已連結");
    // Google is listed with no "linked" mark, so it can be connected from the row.
    expect(await row("Google")).not.toHaveTextContent("已連結");
    expect(screen.getByRole("button", { name: "使用 Google 帳號登入" })).toBeVisible();
    // The only Identity cannot be unlinked.
    expect((await accounts()).queryByRole("button", { name: /解除連結/ })).toBeNull();
  });

  it("shows the LINE name with a LINE tag on the profile card for a LINE sign-in", async () => {
    renderApp({ path: "/settings", cookieUser: bothLinked("小宇") });

    expect(await screen.findByText("小宇")).toBeVisible();
    expect(screen.queryByText("g@example.com")).toBeNull();
  });

  it("shows the Google email with a Google tag on the profile card for a Google sign-in", async () => {
    renderApp({
      path: "/settings",
      cookieUser: { ...bothLinked("小宇"), signedInWith: "google" },
    });

    expect(await screen.findByText("g@example.com")).toBeVisible();
    expect(screen.queryByText("小宇")).toBeNull();
  });

  it("picks up a Google link made in another browser when the page becomes visible again", async () => {
    const { api } = renderApp({
      path: "/settings",
      cookieUser: makeUser("小宇", "line"),
      insideLine: { idToken: null },
    });
    expect(await row("Google")).not.toHaveTextContent("已連結");

    api.changeUserOnServer({
      ...makeUser("小宇", "line"),
      displayName: "G名",
      signedInWith: "google",
      identities: [
        { provider: "line", email: null },
        { provider: "google", email: "g@example.com" },
      ],
    });
    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(async () => {
      expect(await row("Google")).toHaveTextContent("已連結");
    });
    // This device signed in with LINE, so its profile card stays LINE.
    expect(screen.getByText("小宇")).toBeVisible();
    expect(screen.queryByText("g@example.com")).toBeNull();
  });

  it("does not sign the person back in when the refresh answers after they logged out", async () => {
    const user = userEvent.setup();
    const { api } = renderApp({
      path: "/settings",
      cookieUser: makeUser("小宇", "line"),
      insideLine: { idToken: null },
    });
    await accounts();
    const release = api.holdResponses("GET /api/v1/me");
    const meCalls = () => api.calls.filter((c) => c === "GET /api/v1/me").length;
    const before = meCalls();
    document.dispatchEvent(new Event("visibilitychange"));
    // The request must be in flight (answer held) before the person logs out.
    await waitFor(() => {
      expect(meCalls()).toBeGreaterThan(before);
    });
    await user.click(screen.getByRole("button", { name: "登出" }));
    expect(await landingHeading()).toBeVisible();

    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await landingHeading()).toBeVisible();
    expect(screen.queryByRole("heading", { name: "我的設定" })).toBeNull();
  });

  it("keeps Google's own button faintly visible: a fully transparent one ignores finger taps on Android", async () => {
    renderApp({ path: "/settings", cookieUser: makeUser("小宇", "line") });

    expect((await row("Google")).querySelector(".opacity-0")).toBeNull();
  });

  it("saves the Preferred currency from a dropdown right under the profile", async () => {
    const user = userEvent.setup();
    renderApp({ path: "/settings", cookieUser: makeUser("小宇") });

    const select = await screen.findByRole("combobox", { name: "偏好幣別" });
    expect(select).toHaveValue("TWD");
    await user.selectOptions(select, "USD");

    expect(await screen.findByRole("combobox", { name: "偏好幣別" })).toHaveValue("USD");
    expect(screen.getByRole("option", { name: "USD 美元" })).toBeVisible();
    expect(screen.getByRole("option", { name: "JPY 日元" })).toBeVisible();
    expect(screen.getByRole("option", { name: "THB 泰銖" })).toBeVisible();
  });

  it("links Google from Google's own button when outside LINE", async () => {
    const user = userEvent.setup();
    renderApp({ path: "/settings", cookieUser: makeUser("小宇", "line") });

    expect(await row("Google")).not.toHaveTextContent("已連結");
    await user.click(await screen.findByRole("button", { name: "使用 Google 帳號登入" }));

    expect(await row("Google")).toHaveTextContent("已連結");
  });

  it("inside LINE, opens the outside browser with a one-time link code instead of Google's button", async () => {
    const user = userEvent.setup();
    const { api, lineExternalOpens } = renderApp({
      path: "/settings",
      cookieUser: makeUser("小宇", "line"),
      insideLine: { idToken: null },
    });

    expect(await screen.findByRole("button", { name: "連接" })).toBeVisible();
    // The button itself leaves for the outside browser; no extra hint line.
    expect(screen.queryByText(/請用外部瀏覽器/)).toBeNull();
    expect(screen.queryByRole("button", { name: "使用 Google 帳號登入" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "連接" }));

    await waitFor(() => {
      expect(lineExternalOpens).toEqual([`${window.location.origin}/link?code=code-1`]);
    });
    expect(api.calls).toContain("POST /api/v1/auth/link-code");
  });

  it("inside LINE, says so when the outside browser cannot be opened", async () => {
    const user = userEvent.setup();
    renderApp({
      path: "/settings",
      cookieUser: makeUser("小宇", "line"),
      insideLine: { idToken: null },
      openExternalFails: true,
    });

    await user.click(await screen.findByRole("button", { name: "連接" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("小芽出了點狀況");
  });

  it("offers no link once both accounts are linked", async () => {
    renderApp({ path: "/settings", cookieUser: bothLinked("小宇"), insideLine: { idToken: null } });

    expect(await row("Google")).toHaveTextContent("已連結");
    expect(screen.queryByRole("button", { name: "連接" })).toBeNull();
    expect(screen.queryByRole("button", { name: "使用 Google 帳號登入" })).toBeNull();
  });

  it("offers no LINE link to someone signed in with Google, even inside the LINE app", async () => {
    renderApp({
      path: "/settings",
      cookieUser: makeUser("小宇", "google"),
      insideLine: { idToken: "fake|l-1|小宇" },
    });

    expect(await row("Google")).toHaveTextContent("已連結");
    expect(await row("LINE")).toHaveTextContent("即將推出");
    expect(await row("LINE")).not.toHaveTextContent("已連結");
    expect(screen.queryByRole("button", { name: /連結 LINE|連接/ })).toBeNull();
  });

  it("unlinks one of two accounts", async () => {
    const user = userEvent.setup();
    renderApp({ path: "/settings", cookieUser: bothLinked("小宇") });

    await user.click(await (await accounts()).findByRole("button", { name: "解除連結 Google" }));

    await waitFor(async () => {
      expect(await row("Google")).not.toHaveTextContent("已連結");
    });
    expect((await accounts()).queryByRole("button", { name: /解除連結/ })).toBeNull();
  });

  it("signs out and returns to the landing page, with no sign-out-everywhere row", async () => {
    const user = userEvent.setup();
    renderApp({ path: "/settings", cookieUser: makeUser("小宇") });

    expect(await screen.findByRole("button", { name: "刪除帳號" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "登出所有裝置" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "登出" }));

    expect(await landingHeading()).toBeVisible();
  });

  it("deletes the account only after confirming", async () => {
    const user = userEvent.setup();
    const { api } = renderApp({ path: "/settings", cookieUser: makeUser("小宇") });

    await user.click(await screen.findByRole("button", { name: "刪除帳號" }));
    const dialog = within(await screen.findByRole("alertdialog"));
    expect(dialog.getByText(/已刪除的使用者/)).toBeVisible();
    await user.click(dialog.getByRole("button", { name: "取消" }));
    expect(api.calls).not.toContain("DELETE /api/v1/me");

    await user.click(screen.getByRole("button", { name: "刪除帳號" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "確定刪除" }),
    );

    expect(await landingHeading()).toBeVisible();
    expect(api.calls).toContain("DELETE /api/v1/me");
  });

  it("links to the privacy policy and terms", async () => {
    renderApp({ path: "/settings", cookieUser: makeUser("小宇") });

    expect(await screen.findByRole("link", { name: /隱私權政策/ })).toHaveAttribute(
      "href",
      "/privacy",
    );
    expect(screen.getByRole("link", { name: /服務條款/ })).toHaveAttribute("href", "/terms");
  });
});
