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

  it("keeps tiny converted categories visible while showing a consistent monthly total", async () => {
    const { api } = renderApp({ path: "/stats", cookieUser: makeUser("小宇") });
    api.spendingStats.push(
      { month: month(0), category: "餐飲", currency: "USD", amount: 1 },
      { month: month(0), category: "交通", currency: "USD", amount: 1 },
    );
    const categories = await screen.findByRole("region", { name: "花在哪裡？" });
    expect(await within(categories).findByRole("button", { name: /餐飲/ })).toBeVisible();
    expect(within(categories).getByRole("button", { name: /交通/ })).toBeVisible();
    expect((await screen.findAllByText("NT$ 1"))[0]).toBeVisible();
  });

  it("still shows categories when the converted month rounds to zero", async () => {
    const { api } = renderApp({ path: "/stats", cookieUser: makeUser("小宇") });
    api.spendingStats.push({ month: month(0), category: "餐飲", currency: "USD", amount: 1 });
    const categories = await screen.findByRole("region", { name: "花在哪裡？" });
    expect(await within(categories).findByRole("button", { name: /餐飲/ })).toBeVisible();
    expect(within(categories).getByText("—")).toBeVisible();
    expect(within(categories).queryByText(/NaN/)).toBeNull();
  });

  it("displays floating bubble on selected bar, emoji badges, <1% label, and interactive donut center", async () => {
    const user = userEvent.setup();
    const { api } = renderApp({ path: "/stats", cookieUser: makeUser("小宇") });
    api.spendingStats.push(
      { month: month(0), category: "餐飲", currency: "TWD", amount: 450000 },
      { month: month(0), category: "交通", currency: "TWD", amount: 200 },
    );

    const categories = await screen.findByRole("region", { name: "花在哪裡？" });
    // Category list displays emoji badges
    expect(within(categories).getByText("🍽️")).toBeVisible();
    expect(within(categories).getByText("🚗")).toBeVisible();

    // Tiny share shows <1% instead of 0%
    expect(within(categories).getByText("<1%")).toBeVisible();

    // Selected month has floating bubble (450,200 TWD -> 45萬)
    const bars = screen.getByRole("group", { name: "最近六個月" });
    const currentMonthBar = within(bars).getAllByRole("button")[5];
    if (currentMonthBar === undefined) throw new Error("Missing current month");
    expect(within(currentMonthBar).getByText("45萬")).toBeVisible();

    // Donut center displays selected category emoji and amount when clicked
    const foodButton = within(categories).getByRole("button", { name: /餐飲/ });
    await user.click(foodButton);
    expect(within(categories).getAllByText("🍽️")).toHaveLength(2); // In list and in donut center
    expect(within(categories).getAllByText("NT$ 450,000")).toHaveLength(2);

    // Clicking center resets back to total
    const centerEmoji = within(categories).getAllByText("🍽️")[0];
    if (centerEmoji === undefined) throw new Error("Missing center emoji");
    await user.click(centerEmoji);
    expect(within(categories).getAllByText("🍽️")).toHaveLength(1); // Only in list
    expect(within(categories).getByText("我的分攤")).toBeVisible();
  });

  it("formats floating bubble amounts using major units for USD", async () => {
    const { api } = renderApp({
      path: "/stats",
      cookieUser: { ...makeUser("小宇"), preferredCurrency: "USD" },
    });
    api.spendingStats.push({ month: month(0), category: "餐飲", currency: "USD", amount: 1000 }); // $10.00
    const bars = await screen.findByRole("group", { name: "最近六個月" });
    const currentMonthBar = within(bars).getAllByRole("button")[5];
    if (currentMonthBar === undefined) throw new Error("Missing current month");
    // $10 should display as US$ 10.00, not 1k
    expect(within(currentMonthBar).getByText("US$ 10.00")).toBeVisible();
  });
});
