import { screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import type { SeedGroup } from "../../test/fake-groups.js";
import { renderApp } from "../../test/render-app.js";

const me = makeUser("小宇");
const ty = makeUser("ty");

function joining(seed: Omit<SeedGroup, "invite">, options: { signedIn?: boolean } = {}) {
  let id = "";
  const rendered = renderApp({
    path: "/join/tok-1",
    ...(options.signedIn === false ? {} : { cookieUser: me }),
    seed: (groups) => {
      id = groups.add(ty, { ...seed, invite: { token: "tok-1" } });
    },
  });
  return { ...rendered, id: () => id };
}

describe("join through an Invite", () => {
  it("previews the Group, says what Members will see, and joins as a new Member", async () => {
    const user = userEvent.setup();
    const { api, router, id } = joining({ name: "週末台南小旅行", others: [{ name: "宜庭" }] });

    expect(await screen.findByRole("heading", { name: "週末台南小旅行" })).toBeVisible();
    expect(screen.getByText("2 位成員 · 結算幣別 TWD")).toBeVisible();
    expect(screen.getByText("加入後，群組成員會看到你的暱稱和頭像")).toBeVisible();
    expect(screen.queryByText("你是這些人之一嗎？")).toBeNull();

    await user.click(screen.getByRole("button", { name: "加入群組" }));

    expect(await screen.findByRole("tablist", { name: "群組分頁" })).toBeVisible();
    expect(router.state.location.pathname).toBe(`/groups/${id()}`);
    expect(api.groups.members(id()).map((m) => m.name)).toEqual(["ty", "宜庭", "小宇"]);
  });

  it("asks whether I am a Placeholder and claims it after confirming what I take on", async () => {
    const user = userEvent.setup();
    const { api, router, id } = joining({
      name: "台南",
      others: [
        { name: "阿哲", status: "placeholder", addedBy: "ty", balance: -200, expenseCount: 3 },
        { name: "Gulu", status: "placeholder", balance: 150, expenseCount: 1 },
      ],
    });

    const list = await screen.findByRole("list", { name: "你是這些人之一嗎？" });
    expect(within(list).getByText("由 ty 新增")).toBeVisible();
    await user.click(within(list).getByRole("button", { name: "我是 阿哲" }));

    const dialog = await screen.findByRole("dialog", { name: "認領「阿哲」？" });
    expect(within(dialog).getByText("你會承接 阿哲 的 3 筆帳，應付 NT$ 200。")).toBeVisible();
    expect(within(dialog).getByText(/這個名字是 ty 輸入的/)).toBeVisible();
    expect(within(dialog).getByText("認領後無法復原。")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "確認認領" }));

    expect(await screen.findByRole("tablist", { name: "群組分頁" })).toBeVisible();
    expect(router.state.location.pathname).toBe(`/groups/${id()}`);
    const claimed = api.groups.members(id()).find((m) => m.userId === me.id);
    expect(claimed).toMatchObject({ status: "active", balance: -200 });
  });

  it("can still join as a new Member when Placeholders are listed", async () => {
    const user = userEvent.setup();
    const { api, id } = joining({
      name: "台南",
      others: [{ name: "阿哲", status: "placeholder" }],
    });

    await user.click(await screen.findByRole("button", { name: "我不是，以新成員加入" }));

    expect(await screen.findByRole("tablist", { name: "群組分頁" })).toBeVisible();
    expect(api.groups.members(id()).filter((m) => m.status === "placeholder")).toHaveLength(1);
  });

  it("opens the Group straight away for someone already in it", async () => {
    let id = "";
    const { router } = renderApp({
      path: "/join/tok-1",
      cookieUser: me,
      seed: (groups) => {
        id = groups.add(me, { name: "台南", invite: { token: "tok-1" } });
      },
    });

    expect(await screen.findByRole("heading", { level: 1, name: "台南" })).toBeVisible();
    expect(router.state.location.pathname).toBe(`/groups/${id}`);
  });

  it("joins at once from a shared Expense and lands on it, without asking", async () => {
    let id = "";
    const { router, api } = renderApp({
      cookieUser: me,
      seed: (groups) => {
        id = groups.add(ty, {
          name: "台南",
          others: [{ name: "宜庭" }],
          expenses: [{ description: "火鍋", amount: 2160 }],
          invite: { token: "tok-1" },
        });
      },
      pathFor: () => `/join/tok-1?next=${encodeURIComponent(`/groups/${id}/expenses/e-火鍋`)}`,
    });

    expect(await screen.findByText("已加入「台南」")).toBeVisible();
    expect(router.state.location.pathname).toBe(`/groups/${id}/expenses/e-火鍋`);
    expect(api.groups.members(id).map((m) => m.name)).toContain("小宇");
  });

  it("opens the shared Expense for someone already in the Group, with no joining note", async () => {
    let id = "";
    const { router } = renderApp({
      cookieUser: me,
      seed: (groups) => {
        id = groups.add(me, {
          name: "台南",
          expenses: [{ description: "火鍋", amount: 2160 }],
          invite: { token: "tok-1" },
        });
      },
      pathFor: () => `/join/tok-1?next=${encodeURIComponent(`/groups/${id}/expenses/e-火鍋`)}`,
    });

    expect(await screen.findByRole("button", { name: "分享" })).toBeVisible();
    expect(router.state.location.pathname).toBe(`/groups/${id}/expenses/e-火鍋`);
    expect(screen.queryByText(/已加入/)).toBeNull();
  });

  it("still asks who I am when the Group has Placeholders, even from a shared Expense", async () => {
    let id = "";
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        id = groups.add(ty, {
          name: "台南",
          others: [{ name: "阿哲", status: "placeholder" }],
          expenses: [{ description: "火鍋", amount: 2160 }],
          invite: { token: "tok-1" },
        });
      },
      pathFor: () => `/join/tok-1?next=${encodeURIComponent(`/groups/${id}/expenses/e-火鍋`)}`,
    });

    expect(await screen.findByText("你是這些人之一嗎？")).toBeVisible();
  });

  it("never follows a next that leaves the Group", async () => {
    let id = "";
    const { router } = renderApp({
      cookieUser: me,
      seed: (groups) => {
        id = groups.add(me, { name: "台南", invite: { token: "tok-1" } });
      },
      pathFor: () => `/join/tok-1?next=${encodeURIComponent("/settings")}`,
    });

    expect(await screen.findByRole("heading", { level: 1, name: "台南" })).toBeVisible();
    expect(router.state.location.pathname).toBe(`/groups/${id}`);
  });

  it("brings a signed-out visitor back to the join screen after sign-in", async () => {
    const user = userEvent.setup();
    const { router } = joining({ name: "台南" }, { signedIn: false });

    await user.click(await screen.findByRole("button", { name: "使用 Google 帳號登入" }));

    expect(await screen.findByRole("button", { name: "加入群組" })).toBeVisible();
    expect(router.state.location.pathname).toBe("/join/tok-1");
  });

  it.each([
    [
      "an expired link",
      { token: "tok-1", expiresAt: 1 },
      "這個邀請連結已經過期了，請向群組管理員要一個新的連結。",
    ],
    [
      "a regenerated link",
      { token: "tok-other" },
      "這個邀請連結已經失效，可能已被管理員重新產生。",
    ],
  ])("explains %s", async (_, invite, message) => {
    renderApp({
      path: "/join/tok-1",
      cookieUser: me,
      seed: (groups) => {
        groups.add(ty, { name: "台南", invite });
      },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("link", { name: "回到首頁" })).toHaveAttribute("href", "/");
  });

  it("explains a full Group", async () => {
    joining({
      name: "台南",
      others: Array.from({ length: 29 }, (_, i) => ({ name: `朋友${String(i)}` })),
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "這個群組已經滿 30 人了，無法再加入。",
    );
  });
});
