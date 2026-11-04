import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import { renderApp } from "../../test/render-app.js";

describe("/link (finishing a Google link from the outside browser)", () => {
  it("goes to Google at once, comes back, joins the User who asked for the code, and opens settings", async () => {
    const { api, googleRedirects } = renderApp({
      path: "/link?code=code-1",
      seed: () => undefined,
    });
    api.linkCodes.set("code-1", makeUser("小宇", "line"));

    await screen.findByRole("heading", { level: 1, name: "我的設定" });
    const accounts = within(screen.getByRole("list", { name: "已連結的帳號" }));
    expect(accounts.getByText("LINE")).toBeVisible();
    expect(accounts.getByText("Google")).toBeVisible();
    expect(googleRedirects).toEqual([{ purpose: "linkCode", code: "code-1" }]);
  });

  it("never paints the link page before leaving for Google: no flash of the button", async () => {
    const { googleRedirects } = renderApp({ path: "/link?code=code-1", google: "holds" });

    await waitFor(() => {
      expect(googleRedirects).toEqual([{ purpose: "linkCode", code: "code-1" }]);
    });
    expect(screen.queryByRole("button", { name: "使用 Google 登入" })).toBeNull();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    // What shows instead is Google's own opening screen.
    expect(screen.getByRole("status")).toHaveTextContent("前往 Google…");
  });

  it("after Google refuses, stops on the button, and the button still links with the same code", async () => {
    const user = userEvent.setup();
    const { api, googleRedirects, router } = renderApp({
      path: "/link?code=code-1",
      google: "refusesOnce",
    });
    api.linkCodes.set("code-1", makeUser("小宇", "line"));
    const visited: string[] = [];
    router.subscribe((next) => visited.push(next.location.pathname));

    // The auto-redirect goes to Google and comes back refused: wait for that round trip to finish.
    await waitFor(() => {
      expect(visited.slice(-2)).toEqual(["/google-return", "/link"]);
    });
    expect(googleRedirects).toHaveLength(1);

    await user.click(await screen.findByRole("button", { name: "使用 Google 登入" }));

    await screen.findByRole("heading", { level: 1, name: "我的設定" });
    expect(googleRedirects).toHaveLength(2);
  });

  it("does not switch a signed-in browser to another User: it asks to log out first", async () => {
    const user = userEvent.setup();
    const { api, googleRedirects } = renderApp({
      path: "/link?code=code-1",
      cookieUser: makeUser("甲", "line"),
      google: "holds",
    });
    api.linkCodes.set("code-1", makeUser("乙", "line"));

    expect(await screen.findByText(/請先登出/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "使用 Google 登入" })).toBeNull();
    expect(googleRedirects).toEqual([]);

    await user.click(screen.getByRole("button", { name: "登出" }));
    // Logged out, the page goes straight to Google.
    await waitFor(() => {
      expect(googleRedirects).toHaveLength(1);
    });
  });

  it("says so when the code is no longer valid", async () => {
    renderApp({ path: "/link?code=gone" });

    expect(await screen.findByRole("alert")).toHaveTextContent("這個連結已經失效");
  });

  it("asks to leave LINE's own browser instead of showing Google's button, and does it in one tap", async () => {
    const user = userEvent.setup();
    const { lineExternalOpens, googleRedirects } = renderApp({
      path: "/link?code=code-1",
      insideLine: { idToken: null },
    });

    expect(await screen.findByText(/請用外部瀏覽器/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "使用 Google 登入" })).toBeNull();
    expect(googleRedirects).toEqual([]);
    await user.click(screen.getByRole("button", { name: "用瀏覽器開啟" }));
    expect(lineExternalOpens).toEqual([window.location.href]);
  });

  it("inside LINE with a live session, offers the outside browser instead of the log-out wall", async () => {
    const user = userEvent.setup();
    const { lineExternalOpens } = renderApp({
      path: "/link?code=code-1",
      cookieUser: makeUser("甲", "line"),
      insideLine: { idToken: null },
    });

    await user.click(await screen.findByRole("button", { name: "用瀏覽器開啟" }));

    expect(lineExternalOpens).toEqual([window.location.href]);
    // Logging out here would not help: Google cannot sign in inside LINE's browser anyway.
    expect(screen.queryByText(/請先登出/)).toBeNull();
    expect(screen.queryByRole("button", { name: "登出" })).toBeNull();
  });

  it("says so when LINE's outside browser cannot be opened from /link", async () => {
    const user = userEvent.setup();
    renderApp({
      path: "/link?code=code-1",
      insideLine: { idToken: null },
      openExternalFails: true,
    });

    await user.click(await screen.findByRole("button", { name: "用瀏覽器開啟" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("小芽出了點狀況");
  });

  it("says so when LINE's outside browser cannot be opened from the sign-in explanation", async () => {
    const user = userEvent.setup();
    renderApp({ path: "/sign-in", insideLine: { idToken: null }, openExternalFails: true });

    await user.click(await screen.findByRole("button", { name: "使用 Google 登入" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "用瀏覽器開啟" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("小芽出了點狀況");
  });

  it("sign-in inside LINE shows the Google button, which explains and offers the outside browser", async () => {
    const user = userEvent.setup();
    const { lineExternalOpens, googleRedirects } = renderApp({
      path: "/sign-in",
      insideLine: { idToken: null },
    });

    await user.click(await screen.findByRole("button", { name: "使用 Google 登入" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("請用外部瀏覽器登入 Google")).toBeVisible();
    // Google's own sign-in is never started inside LINE's browser.
    expect(googleRedirects).toEqual([]);
    expect(lineExternalOpens).toEqual([]);

    await user.click(dialog.getByRole("button", { name: "用瀏覽器開啟" }));
    expect(lineExternalOpens).toEqual([window.location.href]);
  });

  it("closes the outside-browser explanation on cancel and returns focus to the Google button", async () => {
    const user = userEvent.setup();
    const { lineExternalOpens } = renderApp({ path: "/sign-in", insideLine: { idToken: null } });

    const trigger = await screen.findByRole("button", { name: "使用 Google 登入" });
    await user.click(trigger);
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "取消" }),
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
    expect(lineExternalOpens).toEqual([]);
  });

  it("closes the explanation with Escape and keeps Tab inside it", async () => {
    const user = userEvent.setup();
    renderApp({ path: "/sign-in", insideLine: { idToken: null } });

    const trigger = await screen.findByRole("button", { name: "使用 Google 登入" });
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog");
    await user.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });
});
