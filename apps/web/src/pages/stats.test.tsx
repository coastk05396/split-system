import { screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import { renderApp } from "../../test/render-app.js";

function month(offset: number): string {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

describe("personal spending stats", () => {
  it("converts shares into the preferred currency and switches months and categories", async () => {
    const user = userEvent.setup();
    const { api } = renderApp({ path: "/stats", cookieUser: makeUser("小宇") });
    api.spendingStats.push(
      { month: month(0), category: "餐飲", currency: "TWD", amount: 100 },
      { month: month(0), category: "交通", currency: "USD", amount: 100 },
      { month: month(-1), category: "餐飲", currency: "TWD", amount: 200 },
    );
    api.spendingDetails.push({
      id: "e1",
      groupId: "g1",
      groupName: "聚餐",
      description: "晚餐",
      date: `${month(0)}-01`,
      currency: "USD",
      amount: 100,
    });
    expect((await screen.findAllByText("NT$ 132"))[0]).toBeVisible();
    expect(screen.getByText(/最新參考匯率/)).toBeVisible();
    const categories = screen.getByRole("region", { name: "花在哪裡？" });
    await user.click(within(categories).getByRole("button", { name: /交通/ }));
    expect(within(categories).getByRole("button", { name: /交通/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await screen.findByRole("link", { name: /晚餐/ })).toHaveAttribute(
      "href",
      "/groups/g1/expenses/e1",
    );
    const bars = screen.getByRole("group", { name: "最近六個月" });
    const previous = within(bars).getAllByRole("button")[4];
    if (previous === undefined) throw new Error("Missing previous month");
    await user.click(previous);
    expect(screen.getAllByText("NT$ 200")[0]).toBeVisible();
  });

  it("does not display an incomplete total when an exchange rate is unavailable", async () => {
    const { api } = renderApp({ path: "/stats", cookieUser: makeUser("小宇") });
    api.rates.clear();
    api.spendingStats.push({ month: month(0), category: "餐飲", currency: "USD", amount: 100 });
    expect(await screen.findByRole("alert")).toHaveTextContent("暫時無法取得匯率");
  });
});
