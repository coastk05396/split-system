import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import { renderApp } from "../../test/render-app.js";

const me = makeUser("小宇");

describe("home", () => {
  it("converts every pending Balance into the Preferred currency as one amount", async () => {
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        groups.add(me, { name: "台南小旅行", settlementCurrency: "TWD", myBalance: 393 });
        groups.add(me, { name: "室友", settlementCurrency: "TWD", myBalance: -100 });
        groups.add(me, { name: "紐約", settlementCurrency: "USD", myBalance: 1250 });
        groups.add(me, { name: "已結清", settlementCurrency: "USD", myBalance: 0 });
      },
    });

    // NT$ 293 plus US$ 12.50 at 31.5234, rounded to a whole dollar: NT$ 394.
    const card = await screen.findByRole("region", { name: "目前淨收付" });
    expect(await within(card).findByText("NT$ 687")).toBeVisible();
    expect(within(card).queryByText(/US\$/)).toBeNull();
    expect(within(card).queryByText(/約/)).toBeNull();
    expect(within(card).queryByText(/個群組有待結算款項/)).toBeNull();
    expect(within(card).queryByRole("link", { name: /查看結算明細/ })).toBeNull();
  });

  it("names the rate day for screen readers, and a range when the days differ", async () => {
    const { api } = renderApp({
      cookieUser: me,
      seed: (groups) => {
        groups.add(me, { name: "台南小旅行", settlementCurrency: "TWD", myBalance: 393 });
        groups.add(me, { name: "紐約", settlementCurrency: "USD", myBalance: 1250 });
        groups.add(me, { name: "東京", settlementCurrency: "JPY", myBalance: 8000 });
      },
    });
    api.rates.set("USD-TWD", { rateScaled: 31_523_400, rateDate: "2026-10-28" });
    api.rates.set("JPY-TWD", { rateScaled: 215_000, rateDate: "2026-10-29" });

    const card = await screen.findByRole("region", { name: "目前淨收付" });
    const total = await within(card).findByText("NT$ 2,507");
    const note = within(card).getByText(/參考匯率換算，僅供參考/);
    expect(note).toHaveTextContent("依 2026-10-28 至 2026-10-29 的參考匯率換算");
    expect(total.closest("p")).toHaveAttribute("aria-describedby", note.id);
  });

  it("shows a Balance above one Expense's cap instead of dropping it", async () => {
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        groups.add(me, { name: "東京", settlementCurrency: "JPY", myBalance: 120_000_000 });
      },
    });

    // 120,000,000 JPY at 0.215 is NT$ 25,800,000.
    const card = await screen.findByRole("region", { name: "目前淨收付" });
    expect(await within(card).findByText("NT$ 25,800,000")).toBeVisible();
  });

  it("falls back to each currency side by side when no rate is available", async () => {
    const { api } = renderApp({
      cookieUser: me,
      seed: (groups) => {
        groups.add(me, { name: "台南小旅行", settlementCurrency: "TWD", myBalance: 393 });
        groups.add(me, { name: "紐約", settlementCurrency: "USD", myBalance: 1250 });
      },
    });
    api.rates.clear();

    const card = await screen.findByRole("region", { name: "目前淨收付" });
    expect(await within(card).findByText("NT$ 393")).toBeVisible();
    expect(within(card).getByText("US$ 12.50")).toBeVisible();
  });

  it("opens the settle tab from a pending group, saying plainly who pays", async () => {
    let groupId = "";
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        groupId = groups.add(me, { name: "台南小旅行", settlementCurrency: "TWD", myBalance: 393 });
        groups.add(me, { name: "室友", settlementCurrency: "TWD", myBalance: 0 });
      },
    });

    const row = await screen.findByRole("link", { name: /台南小旅行/ });
    expect(row).toHaveAttribute("href", `/groups/${groupId}?tab=settle`);
    expect(row).toHaveTextContent("你可收 NT$ 393");
    expect(screen.queryByText("室友")).toBeNull();
  });

  it("says what you owe in words, and points to the rest when more than 3 groups are pending", async () => {
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        groups.add(me, { name: "甲", settlementCurrency: "TWD", myBalance: 5 });
        groups.add(me, { name: "乙", settlementCurrency: "TWD", myBalance: 10 });
        groups.add(me, { name: "丙", settlementCurrency: "TWD", myBalance: 20 });
        groups.add(me, { name: "丁", settlementCurrency: "TWD", myBalance: 30 });
        groups.add(me, { name: "戊", settlementCurrency: "TWD", myBalance: -50 });
      },
    });

    expect(await screen.findByRole("link", { name: /戊/ })).toHaveTextContent("你要付 NT$ 50");
    expect(screen.getByRole("link", { name: /還有 2 個群組待結算/ })).toHaveAttribute(
      "href",
      "/groups",
    );
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
    expect(within(card).queryByText(/US\$/)).toBeNull();
    expect(within(card).getByText("目前沒有待結算的款項")).toBeVisible();
    expect(screen.getByText("全部結清 ✓")).toBeVisible();
    expect(screen.queryByText("室友")).toBeNull();
    expect(screen.queryByRole("link", { name: /還有/ })).toBeNull();
  });

  it("offers quick split first and shows Trip as under maintenance, when user has no groups", async () => {
    renderApp({ cookieUser: me });

    const quick = await screen.findByRole("link", { name: /快速分帳/ });
    expect(quick).toHaveAttribute("href", "/groups/new?usage=tab");
    expect(screen.queryByRole("link", { name: /旅行行程/ })).toBeNull();
    const tag = screen.getByText("保養中");
    expect(tag).toBeVisible();
    expect(screen.getByText("旅行行程")).toBeVisible();
    expect(screen.getByText("適合：聚餐分帳、室友合租、日常活動")).toBeVisible();
    // The quick-split card comes first, the Trip card under it.
    expect(quick.compareDocumentPosition(tag) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Verify duplicate buttons are completely removed
    expect(screen.queryByRole("link", { name: "查看群組" })).toBeNull();
    expect(screen.queryByRole("link", { name: /新增分帳或旅程/ })).toBeNull();
  });

  it("shows the total in the Preferred currency, with a tag that opens settings", async () => {
    renderApp({
      cookieUser: { ...me, preferredCurrency: "USD" },
      seed: (groups) => {
        groups.add(me, { name: "台南小旅行", settlementCurrency: "TWD", myBalance: 393 });
        groups.add(me, { name: "紐約", settlementCurrency: "USD", myBalance: 1250 });
      },
    });

    // US$ 12.50 plus NT$ 393 at 0.031723 (US$ 12.47).
    const card = await screen.findByRole("region", { name: "目前淨收付" });
    expect(await within(card).findByText("US$ 24.97")).toBeVisible();
    expect(within(card).queryByText(/NT\$/)).toBeNull();
    expect(within(card).getByRole("link", { name: "偏好幣別 USD，前往設定" })).toHaveAttribute(
      "href",
      "/settings",
    );
  });

  it("lists only the groups that still owe something, and leaves creating to the Groups tab", async () => {
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        groups.add(me, { name: "已結清群組A", settlementCurrency: "TWD", myBalance: 0 });
        groups.add(me, { name: "欠錢群組B", settlementCurrency: "TWD", myBalance: -500 });
        groups.add(me, { name: "被欠群組C", settlementCurrency: "TWD", myBalance: 800 });
        groups.add(me, { name: "已結清群組D", settlementCurrency: "TWD", myBalance: 0 });
      },
    });

    expect(await screen.findByRole("heading", { name: "待結算的群組" })).toBeVisible();
    expect(screen.getByText("欠錢群組B")).toBeVisible();
    expect(screen.getByText("被欠群組C")).toBeVisible();
    expect(screen.queryByText("已結清群組A")).toBeNull();
    expect(screen.queryByText("已結清群組D")).toBeNull();
    expect(screen.queryByRole("link", { name: /新群組/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /查看全部群組/ })).toBeNull();
  });

  it("keeps the start cards below the pending groups", async () => {
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        groups.add(me, { name: "欠錢群組B", settlementCurrency: "TWD", myBalance: -500 });
      },
    });

    const pending = await screen.findByText("欠錢群組B");
    const quick = screen.getByRole("link", { name: /^快速分帳/ });
    // Groups exist, so 快速分帳 goes to the Group picker, not to creating another Group.
    expect(quick).toHaveAttribute("href", "/new?pick=1");
    expect(pending.compareDocumentPosition(quick) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
