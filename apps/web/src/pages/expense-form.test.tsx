import { screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import type { SeedGroup } from "../../test/fake-groups.js";
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
const friends = [{ name: "宜庭" }, { name: "阿哲" }];

function openForm(seed: Partial<SeedGroup> = {}) {
  let id = "";
  const app = renderApp({
    cookieUser: me,
    seed: (groups) => {
      id = groups.add(me, { name: "室友", others: friends, ...seed });
    },
    pathFor: () => `/groups/${id}/expenses/new`,
  });
  return { ...app, id: () => id };
}

const submit = () => screen.getByRole("button", { name: "新增支出" });

describe("add Expense form", () => {
  it("starts in the currency of the Group's latest Expense", async () => {
    let id = "";
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        id = groups.add(me, { name: "美國行", settlementCurrency: "TWD", others: friends });
        const ids = groups.members(id).map((m) => m.id);
        groups.addExpense(
          id,
          {
            description: "Uber",
            category: "交通",
            originalAmount: 2000,
            originalCurrency: "USD",
            fxRateScaled: 32_000_000,
            fxDate: "2026-10-29",
            isCustomRate: false,
            settlementAmount: 640,
            payers: [{ memberId: ids[0], amountMinor: 2000 }],
            split: { method: "equal", participants: ids },
            expenseDate: "2026-10-29",
            expenseTime: null,
          },
          0,
        );
      },
      pathFor: () => `/groups/${id}/expenses/new`,
    });

    expect(await screen.findByRole("button", { name: "幣別 USD" })).toBeVisible();
  });

  it("evaluates the amount field's arithmetic and splits it equally by default", async () => {
    const user = userEvent.setup();
    openForm();

    await user.type(await screen.findByLabelText("名稱"), "晚餐");
    await user.type(screen.getByLabelText("金額"), "120+80×3");

    expect(screen.getByText("= NT$ 360")).toBeVisible();
    const split = within(screen.getByRole("group", { name: "分帳方式" }));
    expect(split.getByRole("button", { name: /參與分帳/ })).toHaveTextContent("全部 3 人");
    await user.click(split.getByRole("button", { name: /參與分帳/ }));
    expect(split.getAllByText("NT$ 120")).toHaveLength(3);
    expect(submit()).toBeEnabled();
  });

  it("keeps submit disabled while the expression cannot be worked out", async () => {
    const user = userEvent.setup();
    openForm();

    await user.type(await screen.findByLabelText("名稱"), "晚餐");
    const amount = screen.getByLabelText("金額");
    await user.type(amount, "120+");
    expect(screen.getByText("算式不完整或含有無法計算的符號。")).toBeVisible();
    expect(submit()).toBeDisabled();

    await user.clear(amount);
    await user.type(amount, "10/0");
    expect(screen.getByText("不能除以 0。")).toBeVisible();
    expect(submit()).toBeDisabled();

    await user.clear(amount);
    await user.type(amount, "0");
    expect(screen.getByText("金額需介於 1 到 99,999,999 之間。")).toBeVisible();
    expect(submit()).toBeDisabled();
  });

  it("does not record the Expense twice when a submit is retried after a network error", async () => {
    const user = userEvent.setup();
    const { api, id, router } = openForm();

    await user.type(await screen.findByLabelText("名稱"), "晚餐");
    await user.type(screen.getByLabelText("金額"), "360");
    api.dropNextResponse(`POST /api/v1/groups/${id()}/expenses`);
    await user.click(submit());

    expect(await screen.findByRole("alert")).toHaveTextContent("網路連線不穩");
    expect(api.groups.expenses.list(id())).toHaveLength(1);

    await user.click(submit());

    expect(await screen.findByRole("heading", { level: 1, name: "室友" })).toBeVisible();
    expect(router.state.location.pathname).toBe(`/groups/${id()}`);
    expect(api.groups.expenses.list(id())).toHaveLength(1);
    const keys = api.requests
      .filter((r) => r.route === `POST /api/v1/groups/${id()}/expenses`)
      .map((r) => r.headers.get("Idempotency-Key"));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    expect(await screen.findByRole("link", { name: /晚餐/ })).toHaveTextContent("NT$ 360");
  });

  it("converts a USD Expense at the reference rate, and a typed converted amount derives the rate", async () => {
    const user = userEvent.setup();
    const { api, id } = openForm();

    await user.type(await screen.findByLabelText("名稱"), "門票");
    await user.click(screen.getByRole("button", { name: "幣別 TWD" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "USD 美元" }));
    await user.type(screen.getByLabelText("金額"), "10");

    const rate = screen.getByLabelText("匯率");
    const converted = screen.getByLabelText("換算金額（TWD）");
    expect(await screen.findByDisplayValue("31.5234")).toBe(rate);
    expect(converted).toHaveValue("315");

    await user.clear(rate);
    await user.type(rate, "30");
    expect(converted).toHaveValue("300");
    expect(screen.getByText("已自訂匯率")).toBeVisible();

    await user.clear(converted);
    await user.type(converted, "320");
    expect(rate).toHaveValue("32.0000");

    await user.click(submit());
    await screen.findByRole("heading", { level: 1, name: "室友" });
    const [saved] = api.groups.expenses.list(id());
    expect(saved).toMatchObject({
      originalAmount: 1000,
      originalCurrency: "USD",
      settlementAmount: 320,
      fxRateScaled: 32_000_000,
      isCustomRate: true,
    });
  });

  it("takes yen, whole and converted at the reference rate", async () => {
    const user = userEvent.setup();
    const { api, id } = openForm();

    await user.type(await screen.findByLabelText("名稱"), "拉麵");
    await user.click(screen.getByRole("button", { name: "幣別 TWD" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "JPY 日元" }));
    await user.type(screen.getByLabelText("金額"), "1500");

    // 1 JPY = 0.215 TWD, so JP¥ 1,500 is NT$ 323 (322.5 rounded up).
    expect(await screen.findByDisplayValue("0.2150")).toBe(screen.getByLabelText("匯率"));
    expect(screen.getByLabelText("換算金額（TWD）")).toHaveValue("323");

    await user.click(submit());
    await screen.findByRole("heading", { level: 1, name: "室友" });
    const [saved] = api.groups.expenses.list(id());
    expect(saved).toMatchObject({
      originalAmount: 1500,
      originalCurrency: "JPY",
      settlementAmount: 323,
      fxRateScaled: 215_000,
    });
  });

  it("displays stale rate badge when the reference rate is from an earlier date", async () => {
    const user = userEvent.setup();
    const { api } = openForm();
    api.rates.set("USD-TWD", {
      rateScaled: 31_523_400,
      rateDate: "2026-05-15",
      stale: true,
    });

    await user.click(await screen.findByRole("button", { name: "幣別 TWD" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "USD 美元" }));
    await user.type(screen.getByLabelText("金額"), "10");

    expect(await screen.findByText("使用 2026-05-15 的匯率")).toBeVisible();
  });

  it("lets someone else pay, or several people pay parts that must add up", async () => {
    const user = userEvent.setup();
    const { api, id } = openForm();

    await user.type(await screen.findByLabelText("名稱"), "住宿");
    await user.type(screen.getByLabelText("金額"), "3000");
    await user.click(screen.getByRole("button", { name: /^誰先付錢/ }));
    await user.click(await screen.findByRole("menuitemradio", { name: "宜庭" }));
    await user.click(screen.getByRole("button", { name: "多人付款" }));

    await user.type(screen.getByLabelText("小宇 付的金額"), "1000");
    await user.type(screen.getByLabelText("宜庭 付的金額"), "1500");
    expect(screen.getByText("付款金額還差 NT$ 500")).toBeVisible();
    expect(submit()).toBeDisabled();
    await user.type(screen.getByLabelText("阿哲 付的金額"), "500");
    expect(submit()).toBeEnabled();

    await user.click(submit());
    await screen.findByRole("heading", { level: 1, name: "室友" });
    const [m1, m2, m3] = api.groups.members(id()).map((m) => m.id);
    expect(api.groups.expenses.list(id())[0]?.payers).toEqual([
      { memberId: m1, amountMinor: 1000, settlementAmount: 1000 },
      { memberId: m2, amountMinor: 1500, settlementAmount: 1500 },
      { memberId: m3, amountMinor: 500, settlementAmount: 500 },
    ]);
  });

  it("links an Expense on a Trip to one of that day's Stops", async () => {
    const user = userEvent.setup();
    const today = new Date();
    const day = [today.getFullYear(), today.getMonth() + 1, today.getDate()]
      .map((n) => String(n).padStart(2, "0"))
      .join("-");
    let id = "";
    const { api } = renderApp({
      cookieUser: me,
      seed: (groups) => {
        id = groups.add(me, { name: "台南", isTrip: true, others: friends });
        groups.expenses.addStop(id, { dayDate: day, title: "赤崁樓", startTime: "10:00" });
      },
      pathFor: () => `/groups/${id}/expenses/new`,
    });

    await user.type(await screen.findByLabelText("名稱"), "門票");
    await user.type(screen.getByLabelText("金額"), "150");
    await user.selectOptions(
      screen.getByLabelText("行程站點（選填）"),
      await screen.findByRole("option", { name: "10:00 赤崁樓" }),
    );
    await user.click(submit());

    await screen.findByRole("heading", { level: 1, name: "台南" });
    expect(api.groups.expenses.list(id)[0]?.stopId).toMatch(/^s-/);
  });

  it("has the 花費 and 轉帳 tabs only", async () => {
    const user = userEvent.setup();
    openForm();

    const tabs = within(await screen.findByRole("tablist", { name: "記錄類型" }));
    expect(tabs.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["花費", "轉帳"]);
    await user.click(tabs.getByRole("tab", { name: "轉帳" }));
    expect(await screen.findByText(/轉帳會記成一筆結算/)).toBeVisible();
  });
});
