import { screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import { renderApp } from "../../test/render-app.js";

const me = makeUser("小宇");

describe("group list", () => {
  it("lists each Group with its usage, size and my Balance in its Settlement currency", async () => {
    renderApp({
      path: "/groups",
      cookieUser: me,
      seed: (groups) => {
        groups.add(me, {
          name: "週末台南小旅行",
          isTrip: true,
          myBalance: 293,
          others: [{ name: "宜庭" }, { name: "阿哲" }, { name: "Gulu" }],
        });
        groups.add(me, { name: "小屋生活費", others: [{ name: "宜庭" }, { name: "阿哲" }] });
        groups.add(me, { name: "紐約", settlementCurrency: "USD", myBalance: -1250 });
      },
    });

    const list = await screen.findByRole("list", { name: "我的群組" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringMatching(/紐約.*快速分帳.*1 人.*你要付 US\$ 12\.50/),
      expect.stringMatching(/小屋生活費.*快速分帳.*3 人.*已結清/),
      expect.stringMatching(/週末台南小旅行.*旅行分帳.*4 人.*你可收 NT\$ 293/),
    ]);
    expect(within(list).getByRole("link", { name: /紐約/ })).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/groups\/g-\d+$/),
    );
    expect(screen.getByRole("link", { name: /建立新群組/ })).toHaveAttribute("href", "/groups/new");
  });

  it("filters by name as you type", async () => {
    const user = userEvent.setup();
    renderApp({
      path: "/groups",
      cookieUser: me,
      seed: (groups) => {
        groups.add(me, { name: "週末台南小旅行" });
        groups.add(me, { name: "小屋生活費" });
      },
    });

    await user.type(await screen.findByRole("searchbox", { name: "搜尋群組" }), "台南");

    const list = screen.getByRole("list", { name: "我的群組" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(within(list).getByText("週末台南小旅行")).toBeVisible();

    await user.clear(screen.getByRole("searchbox", { name: "搜尋群組" }));
    await user.type(screen.getByRole("searchbox", { name: "搜尋群組" }), "東京");
    expect(screen.getByText("沒有符合「東京」的群組")).toBeVisible();
  });

  it("shows the empty state with a create call to action when there are no Groups", async () => {
    renderApp({ path: "/groups", cookieUser: me });

    expect(await screen.findByRole("heading", { name: "從第一個小隊開始吧！" })).toBeVisible();
    expect(screen.getByText("0 個群組")).toBeVisible();
    expect(screen.getByRole("link", { name: "建立第一個群組" })).toHaveAttribute(
      "href",
      "/groups/new",
    );
  });

  it("offers a retry when the list cannot load", async () => {
    const user = userEvent.setup();
    const { api } = renderApp({ path: "/groups", cookieUser: me });
    api.failNext("GET /api/v1/groups");

    expect(await screen.findByRole("alert")).toHaveTextContent("小芽出了點狀況");
    await user.click(screen.getByRole("button", { name: "再試一次" }));

    expect(await screen.findByRole("heading", { name: "從第一個小隊開始吧！" })).toBeVisible();
  });
});
