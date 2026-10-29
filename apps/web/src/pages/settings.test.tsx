import type { Me } from "@split/shared";
import { screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeAll, describe, expect, it } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import { renderApp } from "../../test/render-app.js";

function bothLinked(name: string): Me {
  return { ...makeUser(name, "line"), identities: [{ provider: "line" }, { provider: "google" }] };
}

async function accounts() {
  await screen.findByRole("heading", { level: 1, name: "我的設定" });
  return within(screen.getByRole("region", { name: "已連結的帳號" }));
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
    expect((await accounts()).getByText("LINE 已連結")).toBeVisible();
    expect((await accounts()).getByText("Google 未連結")).toBeVisible();
    // The only Identity cannot be unlinked.
    expect((await accounts()).queryByRole("button", { name: /解除連結/ })).toBeNull();
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

  it("links Google with the Google button", async () => {
    const user = userEvent.setup();
    const { api } = renderApp({ path: "/settings", cookieUser: makeUser("小宇", "line") });

    await user.click(await screen.findByRole("button", { name: "使用 Google 帳號登入" }));

    expect(await (await accounts()).findByText("Google 已連結")).toBeVisible();
    expect(api.calls).toContain("POST /api/v1/auth/link/google");
  });

  it("explains when the Google account already belongs to another 小芽 account", async () => {
    const user = userEvent.setup();
    const { api } = renderApp({ path: "/settings", cookieUser: makeUser("小宇", "line") });
    api.refuseLink = "IDENTITY_LINKED_ELSEWHERE";

    await user.click(await screen.findByRole("button", { name: "使用 Google 帳號登入" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("這個帳號已經是另一個小芽帳號。");
    expect((await accounts()).getByText("Google 未連結")).toBeVisible();
  });

  it("links LINE inside the LINE app", async () => {
    const user = userEvent.setup();
    renderApp({
      path: "/settings",
      cookieUser: makeUser("小宇", "google"),
      insideLine: { idToken: "fake|l-1|小宇" },
    });

    await user.click(await (await accounts()).findByRole("button", { name: "連結 LINE" }));

    expect(await (await accounts()).findByText("LINE 已連結")).toBeVisible();
  });

  it("unlinks one of two accounts", async () => {
    const user = userEvent.setup();
    renderApp({ path: "/settings", cookieUser: bothLinked("小宇") });

    await user.click(await (await accounts()).findByRole("button", { name: "解除連結 Google" }));

    expect(await (await accounts()).findByText("Google 未連結")).toBeVisible();
    expect((await accounts()).queryByRole("button", { name: /解除連結/ })).toBeNull();
  });

  it("signs out every device and returns to the landing page", async () => {
    const user = userEvent.setup();
    const { api } = renderApp({ path: "/settings", cookieUser: makeUser("小宇") });

    await user.click(await screen.findByRole("button", { name: "登出所有裝置" }));

    expect(await landingHeading()).toBeVisible();
    expect(api.calls).toContain("POST /api/v1/auth/logout-all");
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
