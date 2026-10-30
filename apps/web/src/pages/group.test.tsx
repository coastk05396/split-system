import { screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import { renderApp } from "../../test/render-app.js";

// The Trip module is under maintenance in the app; these tests run it switched on.
const trip = vi.hoisted(() => ({ enabled: true }));
vi.mock("../trip/enabled.js", () => ({
  get TRIP_ENABLED() {
    return trip.enabled;
  },
}));
afterEach(() => {
  trip.enabled = true;
});

const me = makeUser("小宇");
const friends = [{ name: "宜庭" }, { name: "阿哲" }, { name: "Gulu" }];

describe("group detail", () => {
  it("shows a Trip with its size, badge, three tabs and one Members and Invite link", async () => {
    let id = "";
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        id = groups.add(me, { name: "週末台南小旅行", isTrip: true, others: friends });
      },
      pathFor: () => `/groups/${id}`,
    });

    expect(await screen.findByRole("heading", { level: 1, name: "週末台南小旅行" })).toBeVisible();
    expect(screen.getByRole("link", { name: "4 位成員" })).toHaveAttribute(
      "href",
      `/groups/${id}/members`,
    );
    expect(screen.getByText("旅行行程")).toBeVisible();
    const tabs = within(screen.getByRole("tablist", { name: "群組分頁" }));
    expect(tabs.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "帳目",
      "行程",
      "結算",
    ]);
    expect(screen.queryByRole("link", { name: "邀請成員" })).toBeNull();
  });

  it("hides the 行程 tab of an existing Trip under maintenance and tags it in red", async () => {
    trip.enabled = false;
    let id = "";
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        id = groups.add(me, { name: "週末台南小旅行", isTrip: true, others: friends });
      },
      pathFor: () => `/groups/${id}`,
    });

    expect(await screen.findByRole("heading", { level: 1, name: "週末台南小旅行" })).toBeVisible();
    expect(screen.getByText("保養中")).toBeVisible();
    const tabs = within(screen.getByRole("tablist", { name: "群組分頁" }));
    expect(tabs.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["帳目", "結算"]);
  });

  it("has no 行程 tab, badge or delete action for a Member of a Running Tab", async () => {
    let id = "";
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        id = groups.add(me, {
          name: "室友",
          role: "member",
          others: [{ name: "ty", role: "admin" }],
        });
      },
      pathFor: () => `/groups/${id}`,
    });

    const tabs = within(await screen.findByRole("tablist", { name: "群組分頁" }));
    expect(tabs.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["帳目", "結算"]);
    expect(screen.queryByText("旅行行程")).toBeNull();
    expect(screen.queryByRole("button", { name: "刪除群組" })).toBeNull();
  });

  it("invites friends when the person is alone in the Group", async () => {
    let id = "";
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        id = groups.add(me, { name: "室友" });
      },
      pathFor: () => `/groups/${id}`,
    });

    expect(await screen.findByText("只有你一個人")).toBeVisible();
    expect(screen.getByRole("link", { name: "邀請朋友" })).toHaveAttribute(
      "href",
      `/groups/${id}/members`,
    );
    expect(screen.getByRole("link", { name: /只有你/ })).toHaveAttribute(
      "href",
      `/groups/${id}/members`,
    );
  });

  it("lets an Admin delete the Group permanently after typing delete", async () => {
    const user = userEvent.setup();
    let id = "";
    const { api, router } = renderApp({
      cookieUser: me,
      seed: (groups) => {
        id = groups.add(me, {
          name: "室友",
          myBalance: 500,
          others: [
            { name: "宜庭", balance: -300 },
            { name: "阿哲", balance: -200 },
          ],
        });
      },
      pathFor: () => `/groups/${id}`,
    });

    await user.click(await screen.findByRole("button", { name: "刪除群組" }));
    const dialog = await screen.findByRole("dialog", { name: "刪除「室友」？" });
    expect(within(dialog).getByText(/永久刪除，無法復原/)).toBeVisible();
    expect(await within(dialog).findByText("目前還有 NT$ 500 尚未結清。")).toBeVisible();
    const confirm = within(dialog).getByRole("button", { name: "永久刪除" });
    expect(confirm).toBeDisabled();

    await user.type(within(dialog).getByLabelText("輸入 delete 以確認"), "delete");
    await user.click(confirm);

    expect(await screen.findByRole("heading", { name: "從第一個小隊開始吧！" })).toBeVisible();
    expect(router.state.location.pathname).toBe("/groups");
    expect(api.groups.exists(id)).toBe(false);
  });

  it("says the Group is not found for someone outside it", async () => {
    renderApp({ cookieUser: me, path: "/groups/g-missing" });

    expect(await screen.findByRole("alert")).toHaveTextContent("找不到這筆資料。");
  });
});
