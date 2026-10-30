import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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

    await user.click(await screen.findByRole("button", { name: "分享群組" }));
    expect(screen.getByRole("img", { name: "加入「週末台南小旅行」的 QR Code" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: /複製邀請連結/ }));

    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/join/tok-abc`);
    expect(await screen.findByRole("status")).toHaveTextContent("已複製邀請連結");
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
    expect(await screen.findByRole("button", { name: "分享群組" })).toBeVisible();
  });

  it("opens LINE's recipient picker directly inside LINE", async () => {
    const user = userEvent.setup();
    let id = "";
    renderApp({
      cookieUser: me,
      insideLine: { idToken: null },
      seed: (groups) => {
        id = groups.add(me, { name: "台南", invite: { token: "tok-line" } });
      },
      pathFor: () => `/groups/${id}/members`,
    });
    await user.click(await screen.findByRole("button", { name: "分享群組" }));
    expect(screen.getByRole("link", { name: "透過 LINE 分享" })).toHaveAttribute(
      "href",
      `https://line.me/R/share?text=${encodeURIComponent(`一起用小芽分帳記「台南」的開銷吧！${window.location.origin}/join/tok-line`)}`,
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

    await user.click(await screen.findByRole("button", { name: "分享群組" }));
    const joinUrl = `${window.location.origin}/join/tok-web`;
    const line = screen.getByRole("link", { name: "透過 LINE 分享" });
    expect(line).toHaveAttribute(
      "href",
      `https://line.me/R/share?text=${encodeURIComponent(`一起用小芽分帳記「台南」的開銷吧！${joinUrl}`)}`,
    );
    expect(screen.getByRole("link", { name: "透過 Telegram 分享" })).toHaveAttribute(
      "href",
      `https://t.me/share/url?url=${encodeURIComponent(joinUrl)}&text=${encodeURIComponent("一起用小芽分帳記「台南」的開銷吧！")}`,
    );
  });

  it("opens the device share menu when available", async () => {
    const user = userEvent.setup();
    const originalShare = Object.getOwnPropertyDescriptor(navigator, "share");
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    try {
      let id = "";
      renderApp({
        cookieUser: me,
        seed: (groups) => {
          id = groups.add(me, { name: "台南", invite: { token: "tok-device" } });
        },
        pathFor: () => `/groups/${id}/members`,
      });

      await user.click(await screen.findByRole("button", { name: "分享群組" }));
      await user.click(screen.getByRole("button", { name: "更多方式…" }));
      expect(share).toHaveBeenCalledWith({
        title: "台南",
        text: "一起用小芽分帳記「台南」的開銷吧！",
        url: `${window.location.origin}/join/tok-device`,
      });
    } finally {
      if (originalShare) Object.defineProperty(navigator, "share", originalShare);
      else Reflect.deleteProperty(navigator, "share");
    }
  });

  it("lets an Admin regenerate the link, which replaces the old one", async () => {
    const user = userEvent.setup();
    let id = "";
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        id = groups.add(me, { name: "台南", invite: { token: "tok-old" } });
      },
      pathFor: () => `/groups/${id}/members`,
    });

    await user.click(await screen.findByRole("button", { name: "分享群組" }));
    await user.click(screen.getByRole("button", { name: "複製邀請連結" }));
    expect(await navigator.clipboard.readText()).toContain("/join/tok-old");
    await user.click(screen.getByRole("button", { name: "關閉 QR Code" }));
    await user.click(screen.getByRole("button", { name: "重新產生連結" }));

    await user.click(await screen.findByRole("button", { name: "分享群組" }));
    await user.click(screen.getByRole("button", { name: "複製邀請連結" }));
    expect(await navigator.clipboard.readText()).not.toContain("tok-old");
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

    await userEvent.click(await screen.findByRole("button", { name: "分享群組" }));
    await userEvent.click(screen.getByRole("button", { name: "複製邀請連結" }));
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
      pathFor: () => `/groups/${id}/members`,
    });

    expect(await screen.findByText("目前沒有有效的邀請連結，請管理員產生新的連結。")).toBeVisible();
    expect(screen.queryByRole("button", { name: "重新產生連結" })).toBeNull();
  });
});
