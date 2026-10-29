import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import { renderApp } from "../../test/render-app.js";

const me = makeUser("小宇");

describe("Invite share", () => {
  it("shows the join link with its 7-day expiry and copies it outside LINE", async () => {
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
    const link = await screen.findByLabelText("邀請連結");
    expect(link).toHaveTextContent(`${window.location.origin}/join/tok-abc`);
    expect(screen.getByText(/前有效（7 天）/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /透過 LINE 分享/ })).toBeNull();

    await user.click(screen.getByRole("button", { name: /複製邀請連結/ }));

    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/join/tok-abc`);
    expect(await screen.findByRole("status")).toHaveTextContent("已複製邀請連結");
  });

  it("has a plain way back to the Group, and one short line of explanation", async () => {
    let id = "";
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        id = groups.add(me, { name: "台南", invite: { token: "tok-back" } });
      },
      pathFor: () => `/groups/${id}/invite`,
    });

    expect(await screen.findByRole("link", { name: "回到群組" })).toHaveAttribute(
      "href",
      `/groups/${id}`,
    );
    expect(screen.getByText("分享連結，拿到連結並登入的人就能加入。")).toBeVisible();
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

    await user.click(await screen.findByRole("button", { name: /透過 LINE 分享/ }));

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

    expect(await screen.findByLabelText("邀請連結")).toHaveTextContent("/join/tok-old");
    expect(screen.getByText("重新產生後，舊連結會立即失效。")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "重新產生連結" }));

    expect(await screen.findByLabelText("邀請連結")).not.toHaveTextContent("tok-old");
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

    expect(await screen.findByLabelText("邀請連結")).toHaveTextContent(/\/join\/token-\d+/);
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
