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
      pathFor: () => `/groups/${id}/members`,
    });

    expect(await screen.findByRole("heading", { name: "成員與邀請" })).toBeVisible();
    expect(screen.queryByText(/\/join\/tok-abc/)).toBeNull();

    await user.click(await screen.findByRole("button", { name: "邀請成員" }));
    expect(
      await screen.findByRole("img", { name: "加入「週末台南小旅行」的 QR Code" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: /複製邀請連結/ }));

    expect(await navigator.clipboard.readText()).toBe(
      `一起用小芽分帳記「週末台南小旅行」的開銷吧！${window.location.origin}/join/tok-abc`,
    );
    expect(await screen.findByRole("status")).toHaveTextContent("已複製邀請連結");
    await user.click(screen.getByRole("button", { name: "關閉 QR Code" }));
    expect(screen.getByRole("button", { name: "邀請成員" })).toHaveFocus();
  });

  it("has one back arrow and a share action", async () => {
    let id = "";
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        id = groups.add(me, { name: "台南", invite: { token: "tok-back" } });
      },
      pathFor: () => `/groups/${id}/members`,
    });

    expect(await screen.findByRole("link", { name: "返回" })).toHaveAttribute(
      "href",
      `/groups/${id}`,
    );
    expect(await screen.findByRole("button", { name: "邀請成員" })).toBeVisible();
  });

  it("opens LINE's recipient picker directly inside LINE", async () => {
    const user = userEvent.setup();
    let id = "";
    const { lineShareMessages } = renderApp({
      cookieUser: me,
      insideLine: { idToken: null },
      seed: (groups) => {
        id = groups.add(me, { name: "台南", invite: { token: "tok-line" } });
      },
      pathFor: () => `/groups/${id}/members`,
    });
    await user.click(await screen.findByRole("button", { name: "邀請成員" }));
    await user.click(await screen.findByRole("button", { name: "透過 LINE 分享" }));

    expect(lineShareMessages).toHaveLength(1);
    expect(lineShareMessages[0]).toMatchObject({
      type: "flex",
      altText: "邀請你加入「台南」一起分帳",
    });
    expect(JSON.stringify(lineShareMessages[0])).toContain(
      `${window.location.origin}/join/tok-line`,
    );
  });

  it("opens LINE and Telegram share links directly outside LINE", async () => {
    const user = userEvent.setup();
    let id = "";
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        id = groups.add(me, { name: "台南", invite: { token: "tok-web" } });
      },
      pathFor: () => `/groups/${id}/members`,
    });

    await user.click(await screen.findByRole("button", { name: "邀請成員" }));
    const joinUrl = `${window.location.origin}/join/tok-web`;
    const line = await screen.findByRole("link", { name: "透過 LINE 分享" });
    expect(line).toHaveAttribute(
      "href",
      `https://line.me/R/share?text=${encodeURIComponent(`一起用小芽分帳記「台南」的開銷吧！${joinUrl}`)}`,
    );
    expect(screen.getByRole("link", { name: "透過 Telegram 分享" })).toHaveAttribute(
      "href",
      `https://t.me/share/url?url=${encodeURIComponent(joinUrl)}&text=${encodeURIComponent("一起用小芽分帳記「台南」的開銷吧！")}`,
    );
  });

  it("does not show regenerate or device share options", async () => {
    const user = userEvent.setup();
    let id = "";
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        id = groups.add(me, { name: "台南", invite: { token: "tok" } });
      },
      pathFor: () => `/groups/${id}/members`,
    });
    await user.click(await screen.findByRole("button", { name: "邀請成員" }));
    await screen.findByRole("img", { name: "加入「台南」的 QR Code" });
    expect(screen.queryByRole("button", { name: "更多方式…" })).toBeNull();
    expect(screen.queryByRole("button", { name: "重新產生連結" })).toBeNull();
  });

  it("makes the first link for an Admin when the Group has none", async () => {
    let id = "";
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        id = groups.add(me, { name: "台南" });
      },
      pathFor: () => `/groups/${id}/members`,
    });

    await userEvent.click(await screen.findByRole("button", { name: "邀請成員" }));
    await userEvent.click(screen.getByRole("button", { name: "複製邀請連結" }));
    expect(await navigator.clipboard.readText()).toMatch(/\/join\/token-\d+/);
  });

  it("lets a Member create a link when none is live", async () => {
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
      pathFor: () => `/groups/${id}/members`,
    });
    await userEvent.click(await screen.findByRole("button", { name: "邀請成員" }));
    await userEvent.click(await screen.findByRole("button", { name: "複製邀請連結" }));
    expect(await navigator.clipboard.readText()).toMatch(/\/join\/token-\d+/);
  });
});
