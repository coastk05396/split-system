import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import { renderApp } from "../../test/render-app.js";

const me = makeUser("小宇");

function expense(
  ids: string[],
  description: string,
  expenseDate: string,
  expenseTime: string | null,
) {
  return {
    description,
    category: "餐飲",
    originalAmount: 100,
    originalCurrency: "TWD",
    fxRateScaled: 1_000_000,
    fxDate: expenseDate,
    isCustomRate: false,
    settlementAmount: 100,
    payers: [{ memberId: ids[0], amountMinor: 100 }],
    split: { method: "equal", participants: ids },
    expenseDate,
    expenseTime,
  };
}

describe("Expense list", () => {
  it("shows what a foreign-currency Expense counts as in the Settlement currency", async () => {
    let id = "";
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        id = groups.add(me, {
          name: "美國行",
          settlementCurrency: "TWD",
          others: [{ name: "宜庭" }],
        });
        const ids = groups.members(id).map((m) => m.id);
        groups.addExpense(
          id,
          {
            ...expense(ids, "Uber", "2026-10-29", "10:00"),
            originalAmount: 2000,
            originalCurrency: "USD",
            fxRateScaled: 32_000_000,
            settlementAmount: 640,
            payers: [{ memberId: ids[0], amountMinor: 2000 }],
          },
          0,
        );
        groups.addExpense(id, expense(ids, "早餐", "2026-10-29", "08:00"), 0);
      },
      pathFor: () => `/groups/${id}`,
    });

    const uber = await screen.findByRole("link", { name: /Uber/ });
    expect(uber).toHaveTextContent("US$ 20.00");
    expect(uber).toHaveTextContent("≈ NT$ 640");
    expect(screen.getByRole("link", { name: /早餐/ })).not.toHaveTextContent("≈");
  });

  it("puts an icon in front of each Expense, with a pill for 醫療", async () => {
    let id = "";
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        id = groups.add(me, {
          name: "室友",
          settlementCurrency: "TWD",
          others: [{ name: "宜庭" }],
        });
        const ids = groups.members(id).map((m) => m.id);
        groups.addExpense(
          id,
          { ...expense(ids, "感冒藥", "2026-10-29", "09:00"), category: "醫療" },
          0,
        );
      },
      pathFor: () => `/groups/${id}`,
    });

    const row = await screen.findByRole("link", { name: /感冒藥/ });
    expect(row.querySelector("svg.lucide-pill")).not.toBeNull();
  });

  it("names each payer with the amount they paid when several people paid", async () => {
    let id = "";
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        id = groups.add(me, {
          name: "室友",
          settlementCurrency: "TWD",
          others: [{ name: "宜庭" }],
        });
        const ids = groups.members(id).map((m) => m.id);
        groups.addExpense(
          id,
          {
            ...expense(ids, "晚餐", "2026-10-29", "19:30"),
            payers: [
              { memberId: ids[0], amountMinor: 60 },
              { memberId: ids[1], amountMinor: 40 },
            ],
          },
          0,
        );
      },
      pathFor: () => `/groups/${id}`,
    });

    const row = await screen.findByRole("link", { name: /晚餐/ });
    expect(row).toHaveTextContent("小宇 先付 NT$ 60、宜庭 先付 NT$ 40");
  });

  it("groups Expenses under a heading per day, the latest day first, with only the payer under each", async () => {
    let id = "";
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        id = groups.add(me, {
          name: "室友",
          settlementCurrency: "TWD",
          others: [{ name: "宜庭" }],
        });
        const ids = groups.members(id).map((m) => m.id);
        groups.addExpense(id, expense(ids, "早餐", "2026-10-28", "08:00"), 0);
        groups.addExpense(id, expense(ids, "午餐", "2026-10-29", "12:00"), 0);
        groups.addExpense(id, expense(ids, "晚餐", "2026-10-29", "19:30"), 0);
      },
      pathFor: () => `/groups/${id}`,
    });

    const list = await screen.findByRole("region", { name: "帳目" });
    const headings = within(list).getAllByRole("heading", { level: 3 });
    expect(headings.map((h) => h.textContent)).toEqual(["2026年10月29日", "2026年10月28日"]);

    const day = within(screen.getByRole("region", { name: "2026年10月29日" }));
    expect(day.getAllByRole("link").map((l) => l.textContent)).toEqual([
      "晚餐小宇 先付 NT$ 100NT$ 100",
      "午餐小宇 先付 NT$ 100NT$ 100",
    ]);
  });

  it("renders the top overview capsule, squircle badges with stamp press, and staggered cascade", async () => {
    let id = "";
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        id = groups.add(me, {
          name: "室友",
          settlementCurrency: "TWD",
          others: [{ name: "宜庭" }],
        });
        const ids = groups.members(id).map((m) => m.id);
        groups.addExpense(id, expense(ids, "早餐", "2026-10-29", "08:00"), 0);
        groups.addExpense(id, expense(ids, "午餐", "2026-10-29", "12:00"), 0);
      },
      pathFor: () => `/groups/${id}`,
    });

    // 1. Overview capsule: 本群累計 NT$ 200 · 你分攤 NT$ 100, without 🌱
    const capsule = await screen.findByText(/本群累計.*NT\$ 200.*你分攤.*NT\$ 100/);
    expect(capsule).toBeVisible();
    expect(capsule.textContent).not.toContain("🌱");

    // 2. Category badge is a squircle (rounded-2xl) with squishy stamp press (scale-[1.08] on active)
    const row = screen.getByRole("link", { name: /早餐/ });
    const badge = row.querySelector(".rounded-2xl");
    expect(badge).not.toBeNull();
    expect(badge?.className).toContain("group-active:scale-[1.08]");
    expect(badge?.className).toContain("ease-(--ease-spring)");

    // 3. 35ms staggered cascade items
    const items = screen.getAllByRole("listitem");
    const itemWithStagger = items.find((li) => li.classList.contains("list-stagger-item"));
    expect(itemWithStagger).toBeDefined();
    expect(itemWithStagger).toHaveStyle({ animationDelay: "0ms" });
  });
});
