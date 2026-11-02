import { screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import { renderApp } from "../../test/render-app.js";

const me = makeUser("小宇");

describe("group list", () => {
  it("lists each Group with its usage and avatar stack, without settlement balance gray text", async () => {
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
    expect(items[0]).toHaveTextContent("紐約");
    expect(items[0]).toHaveTextContent("快速分帳");
    expect(items[1]).toHaveTextContent("小屋生活費");
    expect(items[1]).toHaveTextContent("快速分帳");
    expect(items[2]).toHaveTextContent("週末台南小旅行");
    expect(items[2]).toHaveTextContent("旅行行程");

    // Verify balance and member count gray text is completely removed from all items
    for (const item of items) {
      expect(within(item).queryByText(/已結清/)).toBeNull();
      expect(within(item).queryByText(/你要付/)).toBeNull();
      expect(within(item).queryByText(/你可收/)).toBeNull();
      expect(within(item).queryByText(/\d+\s*人\s*·/)).toBeNull();
      // Ensure AvatarStack is rendered
      expect(item.querySelector(".mt-1.flex.items-center")).not.toBeNull();
    }

    expect(within(list).getByRole("link", { name: /紐約/ })).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/groups\/g-\d+$/),
    );
    expect(screen.getByRole("link", { name: /建立新群組/ })).toHaveAttribute("href", "/groups/new");
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
