import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import { renderApp } from "../../test/render-app.js";

const me = makeUser("小宇");

describe("home", () => {
  it("shows pending Balances side by side per currency, never summed, and links to groups for multiple settlements", async () => {
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        groups.add(me, { name: "台南小旅行", settlementCurrency: "TWD", myBalance: 393 });
        groups.add(me, { name: "室友", settlementCurrency: "TWD", myBalance: -100 });
        groups.add(me, { name: "紐約", settlementCurrency: "USD", myBalance: 1250 });
        groups.add(me, { name: "已結清", settlementCurrency: "USD", myBalance: 0 });
      },
    });

    const card = await screen.findByRole("region", { name: "目前淨收付" });
    expect(await within(card).findByText("NT$ 293 · US$ 12.50")).toBeVisible();
    expect(within(card).getByText("你在 3 個群組有待結算款項")).toBeVisible();

    const settleLink = within(card).getByRole("link", { name: /查看結算明細/ });
    expect(settleLink).toHaveAttribute("href", "/groups");
  });

  it("links directly to group settle tab when exactly 1 group has pending balance", async () => {
    let groupId = "";
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        groupId = groups.add(me, { name: "台南小旅行", settlementCurrency: "TWD", myBalance: 393 });
        groups.add(me, { name: "室友", settlementCurrency: "TWD", myBalance: 0 });
      },
    });

    const card = await screen.findByRole("region", { name: "目前淨收付" });
    const settleLink = await within(card).findByRole("link", { name: /查看結算明細/ });
    expect(settleLink).toHaveAttribute("href", `/groups/${groupId}?tab=settle`);
  });

  it("says everything is settled when no Balance is pending", async () => {
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        groups.add(me, { name: "室友", settlementCurrency: "TWD", myBalance: 0 });
      },
    });

    const card = await screen.findByRole("region", { name: "目前淨收付" });
    expect(await within(card).findByText("NT$ 0")).toBeVisible();
    expect(within(card).getByText("目前沒有待結算的款項")).toBeVisible();
    expect(within(card).queryByRole("link", { name: /查看結算明細/ })).toBeNull();
  });

  it("offers the two ways to start a Group when user has no groups, without duplicate buttons", async () => {
    renderApp({ cookieUser: me });

    expect(await screen.findByRole("link", { name: /旅行分帳/ })).toHaveAttribute(
      "href",
      "/groups/new?usage=trip",
    );
    expect(screen.getByRole("link", { name: /快速分帳/ })).toHaveAttribute(
      "href",
      "/groups/new?usage=tab",
    );
    expect(screen.getByText("適合：出國、跨日旅遊、多人包車")).toBeVisible();
    expect(screen.getByText("適合：聚餐分帳、室友合租、日常活動")).toBeVisible();

    // Verify duplicate buttons are completely removed
    expect(screen.queryByRole("link", { name: "查看群組" })).toBeNull();
    expect(screen.queryByRole("link", { name: /新增分帳或旅程/ })).toBeNull();
  });

  it("shows active groups prioritized by pending balance and offers new group link", async () => {
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        groups.add(me, { name: "已結清群組A", settlementCurrency: "TWD", myBalance: 0 });
        groups.add(me, { name: "欠錢群組B", settlementCurrency: "TWD", myBalance: -500 });
        groups.add(me, { name: "被欠群組C", settlementCurrency: "TWD", myBalance: 800 });
        groups.add(me, { name: "已結清群組D", settlementCurrency: "TWD", myBalance: 0 });
      },
    });

    expect(await screen.findByRole("heading", { name: "我的群組" })).toBeVisible();
    expect(screen.getByRole("link", { name: "＋ 新群組" })).toHaveAttribute("href", "/groups/new");

    // Top 3 groups shown: pending balance ones first
    expect(screen.getByText("欠錢群組B")).toBeVisible();
    expect(screen.getByText("被欠群組C")).toBeVisible();

    // More than 3 groups triggers "view all" link
    const viewAllLink = screen.getByRole("link", { name: /查看全部群組（4）/ });
    expect(viewAllLink).toHaveAttribute("href", "/groups");
  });
});
