import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import { renderApp } from "../../test/render-app.js";

const me = makeUser("小宇");

describe("Invite share", () => {
  it("keeps the link behind a copy action outside LINE", async () => {
    const user = userEvent.setup();
    let id = "";
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        id = groups.add(me, { name: "週末台南小旅行", invite: { token: "tok-abc" } });
      },
      pathFor: () => `/groups/${id}/invite`,
    });

    expect(await screen.findByRole("heading", { name: "邀請成員" })).toBeVisible();
    expect(screen.getByText("週末台南小旅行")).toBeVisible();
    expect(screen.getByRole("heading", { name: "週末台南小旅行" })).toBeVisible();
    expect(screen.queryByText(/\/join\/tok-abc/)).toBeNull();
    expect(screen.getByText(/前有效（7 天）/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /用 LINE 傳送邀請/ })).toBeNull();

    await user.click(screen.getByRole("button", { name: /複製邀請連結/ }));

    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/join/tok-abc`);
    expect(await screen.findByRole("status")).toHaveTextContent("已複製邀請連結");
  });

  it("has one back arrow and one short explanation", async () => {
    let id = "";
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        id = groups.add(me, { name: "台南", invite: { token: "tok-back" } });
      },
      pathFor: () => `/groups/${id}/invite`,
    });

    expect(await screen.findByRole("link", { name: "返回" })).toHaveAttribute(
      "href",
      `/groups/${id}`,
    );
    expect(screen.getByText("複製連結傳給朋友，登入後就能一起記帳。")).toBeVisible();
  });

  it("shares through the LINE share target picker inside LINE", async () => {
    const user = userEvent.setup();
    let id = "";
    const { lineShares } = renderApp({
      cookieUser: me,
      insideLine: { idToken: null },
      seed: (groups) => {
        id = groups.add(me, { name: "台南", invite: { token: "tok-line" } });
      },
      pathFor: () => `/groups/${id}/invite`,
    });

    await user.click(await screen.findByRole("button", { name: /用 LINE 傳送邀請/ }));

    expect(screen.getByText("選好友、聊天或群組，邀請連結會直接送出。")).toBeVisible();
    expect(lineShares).toEqual([
      `一起用小芽分帳記「台南」的開銷吧！${window.location.origin}/join/tok-line`,
    ]);
    expect(await screen.findByRole("status")).toHaveTextContent("已分享到 LINE");
  });

  it("lets an Admin regenerate the link, which replaces the old one", async () => {
    const user = userEvent.setup();
    let id = "";
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        id = groups.add(me, { name: "台南", invite: { token: "tok-old" } });
      },
      pathFor: () => `/groups/${id}/invite`,
    });

    await user.click(await screen.findByRole("button", { name: "複製邀請連結" }));
    expect(await navigator.clipboard.readText()).toContain("/join/tok-old");
    expect(screen.getByText("重新產生後，舊連結會立即失效。")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "重新產生連結" }));

    await user.click(await screen.findByRole("button", { name: "複製邀請連結" }));
    expect(await navigator.clipboard.readText()).not.toContain("tok-old");
  });

  it("makes the first link for an Admin when the Group has none", async () => {
    let id = "";
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        id = groups.add(me, { name: "台南" });
      },
      pathFor: () => `/groups/${id}/invite`,
    });

    await userEvent.click(await screen.findByRole("button", { name: "複製邀請連結" }));
    expect(await navigator.clipboard.readText()).toMatch(/\/join\/token-\d+/);
  });

  it("asks a Member without a live link to get one from an Admin", async () => {
    let id = "";
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        id = groups.add(me, {
          name: "台南",
          role: "member",
          others: [{ name: "ty", role: "admin" }],
        });
      },
      pathFor: () => `/groups/${id}/invite`,
    });

    expect(await screen.findByText("目前沒有有效的邀請連結，請管理員產生新的連結。")).toBeVisible();
    expect(screen.queryByRole("button", { name: "重新產生連結" })).toBeNull();
  });
});
